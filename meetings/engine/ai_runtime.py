"""Durable editorial jobs, per-provider budgets and usage for meetings."""
import json
import logging
import threading
import time
import uuid
from urllib.request import HTTPRedirectHandler, build_opener

LOG = logging.getLogger(__name__)
MAX_ATTEMPTS = 3
LEASE_SECONDS = 180


def stamp(): return int(time.time())
def packed(value): return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
def uid(): return uuid.uuid4().hex


def schema():
    # Existing legacy tables are left untouched. New stores create only active tables.
    return [
        """CREATE TABLE IF NOT EXISTS ai_jobs (
            id TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES norte_users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
            payload TEXT NOT NULL, result TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
            created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, available_at BIGINT NOT NULL,
            lease_until BIGINT NOT NULL DEFAULT 0, dedup_key TEXT NOT NULL UNIQUE)""",
        'CREATE INDEX IF NOT EXISTS ai_jobs_queue ON ai_jobs(status, available_at)',
        """CREATE TABLE IF NOT EXISTS ai_usage (
            id TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES norte_users(id) ON DELETE CASCADE,
            provider TEXT NOT NULL, model TEXT NOT NULL, lane TEXT NOT NULL, status TEXT NOT NULL,
            input_tokens BIGINT, output_tokens BIGINT, cost_usd DOUBLE PRECISION,
            cost_basis TEXT NOT NULL, latency_ms DOUBLE PRECISION NOT NULL,
            details TEXT NOT NULL, created_at BIGINT NOT NULL)""",
        'CREATE INDEX IF NOT EXISTS ai_usage_time ON ai_usage(created_at)',
        """CREATE TABLE IF NOT EXISTS ai_budget (
            day TEXT PRIMARY KEY, calls INTEGER NOT NULL, reserved_usd DOUBLE PRECISION NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS ai_minutes_budget (
            day TEXT PRIMARY KEY, calls INTEGER NOT NULL)""",
    ]


class Runtime:
    def __init__(self, store, settings):
        self.store, self.settings = store, settings
        for sql in schema(): store._run(sql)
        self.stop_event = threading.Event()
        self.wake = threading.Event()
        self.worker = None
        self.provider_slots = threading.BoundedSemaphore(1)
        self.last_maintenance = 0
        from meetings.engine.block_agents import BlockAgents
        self.blocks = BlockAgents(self)

    def start(self):
        if not self.settings.ai_agents_enabled or self.worker: return
        self.worker = threading.Thread(target=self._loop, name='meeting-editorial-worker', daemon=True)
        self.worker.start()

    def stop(self):
        self.stop_event.set(); self.wake.set()
        if self.worker: self.worker.join(timeout=15)

    def _loop(self):
        while not self.stop_event.is_set():
            try:
                if stamp() - self.last_maintenance > 3600:
                    self.prune(); self.last_maintenance = stamp()
                if self.run_once(): continue
            except Exception as error:
                # Never log prompts, transcripts, credentials or provider error bodies.
                LOG.warning('AI worker error: %s', type(error).__name__)
            self.wake.wait(2); self.wake.clear()

    def enqueue(self, user_id, kind, payload=None, dedup_key=None):
        now, job_id = stamp(), uid()
        if kind != 'blocks': raise ValueError('Agente inválido.')
        dedup = dedup_key or uid()
        row = self.store._run("INSERT INTO ai_jobs(id,user_id,kind,status,payload,created_at,updated_at,available_at,dedup_key) VALUES(%s,%s,%s,'queued',%s,%s,%s,%s,%s) ON CONFLICT(dedup_key) DO NOTHING RETURNING id",
                              (job_id, user_id, kind, packed(payload or {}), now, now, now, dedup), 'one')
        self.wake.set()
        if not row: row = self.store._run('SELECT id FROM ai_jobs WHERE dedup_key=%s', (dedup,), 'one')
        return {'job_id': row[0], 'status': 'queued'}


    def claim(self):
        now = stamp()
        self.store._run("UPDATE ai_jobs SET status='error',error='Limite de tentativas após interrupção.',updated_at=%s WHERE kind='blocks' AND status='running' AND lease_until<%s AND attempts>=%s", (now, now, MAX_ATTEMPTS))
        row = self.store._run("SELECT id FROM ai_jobs WHERE kind='blocks' AND ((status='queued' AND available_at<=%s) OR (status='running' AND lease_until<%s)) AND attempts<%s ORDER BY created_at,id LIMIT 1", (now, now, MAX_ATTEMPTS), 'one')
        if not row: return None
        return self.store._run("UPDATE ai_jobs SET status='running',attempts=attempts+1,lease_until=%s,updated_at=%s WHERE id=%s AND ((status='queued' AND available_at<=%s) OR (status='running' AND lease_until<%s)) AND attempts<%s RETURNING id,user_id,kind,payload,attempts",
                               (now + LEASE_SECONDS, now, row[0], now, now, MAX_ATTEMPTS), 'one')

    def run_once(self):
        row = self.claim()
        if not row: return False
        job_id, user_id, kind, raw, attempt = row
        try:
            payload = json.loads(raw)
            result = self.blocks.process(user_id, payload)
            self.store._run("UPDATE ai_jobs SET status='done',result=%s,error='',updated_at=%s,lease_until=0 WHERE id=%s AND status='running' AND attempts=%s", (packed(result), stamp(), job_id, attempt))
        except Exception as error:
            self.store._run('UPDATE ai_jobs SET status=%s,error=%s,updated_at=%s,available_at=%s,lease_until=0 WHERE id=%s AND attempts=%s',
                            ('error' if attempt >= MAX_ATTEMPTS else 'queued', type(error).__name__ + ': agente não concluiu a tarefa.', stamp(), stamp() + min(120, 10 * 2 ** attempt), job_id, attempt))
        return True


    def paid_ready(self):
        s = self.settings
        _, _, key, rates = self.provider_config()
        return bool(s.ai_agents_enabled and s.ai_external_review_enabled and key and all(rate is not None for rate in rates))

    def provider_config(self):
        s = self.settings
        if s.ai_agent_provider == 'openai':
            return ('openai', s.ai_openai_model, s.openai_api_key, (s.ai_openai_input_usd_per_million, s.ai_openai_output_usd_per_million))
        return ('gemini', s.ai_agent_model, s.gemini_api_key, (s.ai_gemini_input_usd_per_million, s.ai_gemini_output_usd_per_million))

    def provider_status(self):
        provider, model, key, _ = self.provider_config()
        row = self.store._run("SELECT status,details,created_at FROM ai_usage WHERE provider=%s AND model=%s AND lane='blocks' ORDER BY created_at DESC,id DESC LIMIT 1", (provider, model), 'one')
        return {'provider': provider, 'model': model, 'configured': bool(key),
                'verified': bool(row and row[0] == 'success'),
                'last_status': row[0] if row else 'untested', 'last_check_at': row[2] if row else None,
                'last_error': json.loads(row[1]).get('provider_error') if row else None}

    def reserve_minutes_call(self):
        """Persistent, account-shared UTC limit; failed attempts also consume a slot."""
        day = time.strftime('%Y-%m-%d', time.gmtime())
        self.store._run('INSERT INTO ai_minutes_budget(day,calls) VALUES(%s,0) ON CONFLICT(day) DO NOTHING', (day,))
        row = self.store._run('UPDATE ai_minutes_budget SET calls=calls+1 WHERE day=%s AND calls<%s RETURNING calls',
                              (day, self.settings.minutes_daily_call_limit), 'one')
        return row is not None

    def reserve_budget(self, maximum):
        day = time.strftime('%Y-%m-%d', time.gmtime())
        self.store._run('INSERT INTO ai_budget(day,calls,reserved_usd) VALUES(%s,0,0) ON CONFLICT(day) DO NOTHING', (day,))
        row = self.store._run('UPDATE ai_budget SET calls=calls+1,reserved_usd=reserved_usd+%s WHERE day=%s AND calls<%s AND reserved_usd+%s<=%s RETURNING calls',
                              (maximum, day, self.settings.ai_daily_call_limit, maximum, self.settings.ai_daily_budget_usd), 'one')
        return day if row else None


    def record_usage(self, user_id, provider, model, lane, response, latency_ms, status='success', details=None):
        usage = response.get('usageMetadata', response.get('usage', {})) if isinstance(response, dict) else {}
        if not isinstance(usage, dict): usage = {}
        def tokens(*keys):
            for key in keys:
                value = usage.get(key)
                if type(value) is int and 0 <= value <= 100000000: return value
            return None
        inputs = tokens('promptTokenCount', 'input_tokens', 'prompt_tokens')
        outputs = tokens('candidatesTokenCount', 'output_tokens', 'completion_tokens')
        thoughts = tokens('thoughtsTokenCount')
        if outputs is not None and thoughts: outputs += thoughts
        cost, basis = None, 'unknown'
        s = self.settings
        if provider == 'jev' and s.jev_usd_per_request is not None:
            cost, basis = s.jev_usd_per_request, 'configured_per_request'
        elif inputs is not None:
            if provider == 'gemini' and lane == 'minutes' and model == s.gemini_model: rates = (s.minutes_input_usd_per_million, s.minutes_output_usd_per_million)
            elif provider == 'gemini' and lane == 'blocks' and model == s.ai_agent_model: rates = (s.ai_gemini_input_usd_per_million, s.ai_gemini_output_usd_per_million)
            elif provider == 'openai' and model == s.ai_openai_model: rates = (s.ai_openai_input_usd_per_million, s.ai_openai_output_usd_per_million)
            elif provider == 'jev': rates = (s.jev_input_usd_per_million, s.jev_output_usd_per_million)
            else: rates = (None, None)
            if all(r is not None for r in rates) and (outputs is not None or rates[1] == 0):
                cost, basis = (inputs * rates[0] + (outputs or 0) * rates[1]) / 1000000, 'measured_tokens_configured_rate'
        # An error without usage is not a zero-dollar successful call.
        if status != 'success' and inputs is None and outputs is None: cost, basis = None, 'unknown'
        self.store._run('INSERT INTO ai_usage(id,user_id,provider,model,lane,status,input_tokens,output_tokens,cost_usd,cost_basis,latency_ms,details,created_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                        (uid(), user_id, provider, model, lane, status, inputs, outputs, cost, basis, max(0, float(latency_ms)), packed(details or {}), stamp()))
        return cost


    def prune(self):
        cutoff = stamp() - self.settings.ai_retention_days * 86400
        self.blocks.prune(cutoff)
        self.store._run('DELETE FROM ai_usage WHERE created_at<%s', (cutoff,))
        self.store._run("DELETE FROM ai_jobs WHERE kind='blocks' AND updated_at<%s AND status IN ('done','error')", (cutoff,))
        self.store._run('DELETE FROM ai_budget WHERE day<%s', (time.strftime('%Y-%m-%d', time.gmtime(cutoff)),))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None


AI_HTTP = build_opener(NoRedirect())
