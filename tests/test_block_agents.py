import dataclasses
import json
import unittest
import threading
from urllib.error import HTTPError
from unittest.mock import patch

from meetings.engine import ai_runtime
import auth
from meetings.engine import block_agents as B
import config


SOURCE = ('Nós conversamos bastante sobre o suporte e, depois de toda a conversa sobre esse suporte, '
          'ficou decidido que Marina revisará o suporte na sexta-feira.')
SUMMARY = 'Marina revisará o suporte na sexta-feira.'


def verdict(evidence, approved, reason):
    # The critic judges each candidate on its own.
    return {'items': [{'id': c['id'], 'approved': approved(c) if callable(approved) else approved, 'reason': reason} for c in evidence['candidate']]}


def meeting(text=SOURCE):
    return {'id': 's1', 'meeting_events': [{'event_id': 'E1', 'thread_id': 'T1', 'type': 'decision', 'text': text}],
            'meeting_threads': [{'thread_id': 'T1'}], 'topic_titles': {}}


class BlockTests(unittest.TestCase):
    def setUp(self):
        self.store = auth.Store()
        self.user = self.store.create_user('tester', 'fixture-password')['id']
        self.other = self.store.create_user('other', 'fixture-password')['id']
        self.runtime = ai_runtime.Runtime(self.store, dataclasses.replace(config.Settings(), ai_external_review_enabled=True,
                                         gemini_api_key='fixture', ai_gemini_input_usd_per_million=.3, ai_gemini_output_usd_per_million=2.5))
        self.blocks = self.runtime.blocks
        self.save(meeting())

    def tearDown(self):
        self.runtime.stop(); self.store.close()

    def save(self, run, session='s1', user=None):
        self.store.put_record(user or self.user, B.PREFIX + session, json.dumps(run))

    def model(self, user, task, evidence):
        if task == 'judge': return verdict(evidence, True, 'Fiel ao original.')
        return {'items': [{'id': i['id'], 'text': SUMMARY if i['kind'] == 'block' else 'Revisão do suporte'} for i in evidence['items']]}

    def process(self):
        response = self.blocks.review(self.user, {'session_id': 's1'})
        with patch.object(self.blocks, 'ask', side_effect=self.model) as model:
            self.runtime.run_once()
        return self.blocks.review(self.user, {'session_id': 's1'}), model.call_count, response

    def test_inspection_is_scoped_to_saved_meeting_and_user(self):
        self.process()
        result = self.blocks.inspect(self.user, {'session_id': 's1'})
        self.assertFalse(result['external_context'])
        self.assertEqual(result['editorial_total'], 2)
        self.assertEqual(result['learning']['version'], 0)
        with self.assertRaises(ValueError): self.blocks.inspect(self.other, {'session_id': 's1'})
        with self.assertRaises(ValueError): self.blocks.inspect(self.user, {'session_id': 'other'})
        with self.assertRaises(ValueError): self.blocks.inspect(self.user, {'session_id': 's1', 'user_id': self.other})

    def test_editor_critic_publish_overlay_without_mutating_original(self):
        before = self.store.get_record(self.user, B.PREFIX + 's1')
        result, calls, _ = self.process()
        self.assertEqual(calls, 2)
        self.assertEqual(result['review']['blocks']['E1']['text'], SUMMARY)
        self.assertEqual(result['review']['titles']['T1']['text'], 'Revisão do suporte')
        self.assertEqual(self.store.get_record(self.user, B.PREFIX + 's1'), before)
        self.assertEqual(self.blocks.overview()['human_labels'], 0)
        self.assertIsNone(self.blocks.overview()['human_acceptance'])

    def test_queue_deduplicates_and_repeated_reads_do_not_call_provider(self):
        one = self.blocks.review(self.user, {'session_id': 's1'})
        two = self.blocks.review(self.user, {'session_id': 's1'})
        self.assertEqual(one['job_id'], two['job_id'])
        with patch.object(self.blocks, 'ask', side_effect=self.model) as model:
            self.runtime.run_once()
            for _ in range(4): self.blocks.review(self.user, {'session_id': 's1'})
            self.assertFalse(self.runtime.run_once())
        self.assertEqual(model.call_count, 2)

    def test_human_correction_stays_in_same_meeting_source_context_and_account(self):
        result, _, _ = self.process()
        entry = result['review']['blocks']['E1']
        body = {'session_id': 's1', 'id': 'E1', 'kind': 'block', 'key': entry['key'], 'version': entry['version'],
                'action': 'correct', 'text': 'Na sexta-feira, Marina revisará o suporte.'}
        corrected = self.blocks.feedback(self.user, body)
        self.assertEqual(corrected['review']['blocks']['E1']['origin'], 'human')
        self.assertEqual(corrected['review']['blocks']['E1']['version'], 2)
        with self.assertRaises(ValueError): self.blocks.feedback(self.user, body)  # stale edit
        self.save(meeting(), 's2')
        reused = self.blocks.review(self.user, {'session_id': 's2'})
        self.assertEqual(reused['review']['blocks'], {})
        self.assertEqual(self.blocks.review(self.user, {'session_id': 's1'})['review']['blocks']['E1']['text'], body['text'])
        self.assertEqual(self.blocks.overview()['human_reused_items'], 0)
        self.save(meeting(), user=self.other)
        self.assertEqual(self.blocks.review(self.other, {'session_id': 's1'})['review']['blocks'], {})
        changed = meeting(); changed['meeting_events'].insert(0, {'event_id': 'E0', 'thread_id': 'T1', 'type': 'observation', 'text': 'Novo contexto.'})
        self.save(changed, 's3')
        self.assertEqual(self.blocks.review(self.user, {'session_id': 's3'})['review']['blocks'], {})

    def test_restore_and_admin_disable_prevent_republication(self):
        result, _, _ = self.process(); entry = result['review']['blocks']['E1']
        restored = self.blocks.feedback(self.user, {'session_id': 's1', 'kind': 'block', 'id': 'E1', 'key': entry['key'], 'version': entry['version'], 'action': 'restore'})
        self.assertNotIn('E1', restored['review']['blocks'])
        title = result['review']['titles']['T1']
        self.blocks.disable({'user_id': self.user, 'key': title['key']})
        self.assertEqual(self.blocks.review(self.user, {'session_id': 's1'})['review'], {'blocks': {}, 'titles': {}})
        self.assertFalse(self.runtime.run_once())

    def test_legacy_editorial_key_is_read_only_in_its_original_meeting(self):
        result, _, _ = self.process()
        scoped = result['review']['blocks']['E1']['key']
        legacy = next(item['key'] for item in B.items_for(meeting()) if item['kind'] == 'block')
        self.store._run('UPDATE ai_block_memory SET key=%s WHERE user_id=%s AND key=%s', (legacy, self.user, scoped))
        with patch.object(self.blocks, 'ask') as provider:
            original = self.blocks.review(self.user, {'session_id': 's1'})
            self.assertEqual(original['review']['blocks']['E1']['text'], SUMMARY)
            self.assertEqual(original['review']['blocks']['E1']['key'], legacy)
            self.save({**meeting(), 'id': 's2'}, 's2')
            self.assertEqual(self.blocks.review(self.user, {'session_id': 's2'})['review']['blocks'], {})
            provider.assert_not_called()

    def test_capture_sized_pieces_are_organized_but_tiny_ones_are_not(self):
        # A sentence of about a dozen words reaches the editor; a shorter one already reads as a note.
        piece = 'Vamos manter a carga útil em 550 kg até revisarmos o enquadramento no MTCR.'
        self.assertEqual([item['kind'] for item in B.items_for(meeting('Quero saber o que falta antes de aprovar isso.'))], ['title'])
        self.assertGreaterEqual(len(piece), B.EDITORIAL_MIN)
        self.assertEqual([item['kind'] for item in B.items_for(meeting(piece))], ['block', 'title'])
        self.assertEqual([item['kind'] for item in B.items_for(meeting('Certo.'))], ['title'])

    def test_manual_titles_and_short_blocks_need_no_editor(self):
        run = meeting('Texto já curto.'); run['topic_titles']['T1'] = 'Meu título'
        self.save(run)
        result = self.blocks.review(self.user, {'session_id': 's1'})
        self.assertEqual(result['status'], 'ready'); self.assertFalse(self.runtime.run_once())

    def test_critic_rejects_once_then_editor_repairs(self):
        calls = []
        def answer(user, task, evidence):
            calls.append(task)
            if task == 'judge': return verdict(evidence, len(calls) == 4, 'Preserve o prazo.')
            if len(calls) == 3: self.assertIn('previous', evidence)
            return self.model(user, task, evidence)
        self.blocks.review(self.user, {'session_id': 's1'})
        with patch.object(self.blocks, 'ask', side_effect=answer): self.runtime.run_once()
        self.assertEqual(calls, ['edit', 'judge', 'edit', 'judge'])
        self.assertEqual(self.blocks.review(self.user, {'session_id': 's1'})['review']['blocks']['E1']['text'], SUMMARY)
        self.assertEqual(len(self.blocks.overview()['evaluations']), 2)

    def test_one_weak_note_does_not_discard_the_rest_of_its_topic(self):
        run = meeting()
        run['meeting_events'].append({'event_id': 'E2', 'thread_id': 'T1', 'type': 'requirement', 'text': 'A chapa de alumínio precisa ter pelo menos 3 mm de espessura na fixação.'})
        self.save(run)
        seen = []
        def answer(user, task, evidence):
            seen.append((task, json.loads(json.dumps(evidence))))
            if task == 'judge': return verdict(evidence, True, 'Fiel.')
            # The note for E2 drops "3 mm" on both attempts; the other items are fine.
            return {'items': [{'id': i['id'], 'text': 'Revisão do suporte' if i['kind'] == 'title' else SUMMARY if i['original'] == SOURCE else 'Chapa de alumínio com espessura mínima na fixação.'} for i in evidence['items']]}
        self.blocks.review(self.user, {'session_id': 's1'})
        with patch.object(self.blocks, 'ask', side_effect=answer): self.runtime.run_once()
        self.assertEqual([task for task, _ in seen], ['edit', 'judge', 'edit'], 'a note that fails the local checks never reaches the critic')
        self.assertEqual(len(seen[1][1]['candidate']), 2)
        retry = seen[2][1]
        self.assertEqual([i['original'] for i in retry['items']], [run['meeting_events'][1]['text']], 'only the failed note is written again')
        self.assertEqual(retry['previous']['items'][0]['problem'], B.NOTE_PROBLEMS['numbers'])
        result = self.blocks.review(self.user, {'session_id': 's1'})
        self.assertEqual(result['review']['blocks']['E1']['text'], SUMMARY)
        self.assertNotIn('E2', result['review']['blocks'], 'the refused note shows the speech as said')
        self.assertEqual(result['review']['titles']['T1']['text'], 'Revisão do suporte')
        self.assertEqual(result['remaining'], 0)
        evaluations = sorted(self.blocks.overview()['evaluations'], key=lambda e: e['details']['attempt'])
        self.assertEqual([(e['status'], e['details']['approved'], e['details']['checks']) for e in evaluations], [('partial', 2, {'numbers': 1}), ('rejected', 0, {'numbers': 1})])

    def test_failed_critic_keeps_original_and_does_not_retry_forever(self):
        def answer(user, task, evidence): return verdict(evidence, False, 'Omitiu decisão.') if task == 'judge' else self.model(user, task, evidence)
        self.blocks.review(self.user, {'session_id': 's1'})
        with patch.object(self.blocks, 'ask', side_effect=answer) as model:
            self.runtime.run_once()
            result = self.blocks.review(self.user, {'session_id': 's1'})
            self.assertFalse(self.runtime.run_once()); self.assertEqual(model.call_count, 4)
        self.assertEqual(result['review']['blocks'], {})

    def test_unavailable_critic_does_not_publish_or_mark_content_bad(self):
        self.blocks.review(self.user, {'session_id': 's1'})
        with patch.object(self.blocks, 'ask', side_effect=lambda u,t,e: None if t == 'judge' else self.model(u,t,e)):
            self.runtime.run_once()
        result = self.blocks.review(self.user, {'session_id': 's1'})
        self.assertEqual(result['status'], 'waiting')
        self.assertEqual(self.blocks.overview()['memory'], [])

    def test_midflight_change_discards_changed_content(self):
        def answer(user, task, evidence):
            if task == 'judge': self.save(meeting('Mudou o que foi dito.'))
            return self.model(user, task, evidence)
        self.blocks.review(self.user, {'session_id': 's1'})
        with patch.object(self.blocks, 'ask', side_effect=answer): self.runtime.run_once()
        self.assertEqual(self.blocks.overview()['memory'], [])

    def test_midflight_new_speech_keeps_blocks_and_the_title_of_the_first_events(self):
        def answer(user, task, evidence):
            if task == 'judge':
                run = meeting(); run['meeting_events'].append({'event_id':'E2','thread_id':'T1','type':'observation','text':'Outro ponto importante.'}); self.save(run)
            return self.model(user, task, evidence)
        self.blocks.review(self.user, {'session_id':'s1'})
        with patch.object(self.blocks, 'ask', side_effect=answer): self.runtime.run_once()
        result=self.blocks.review(self.user, {'session_id':'s1'})
        self.assertIn('E1',result['review']['blocks'])
        # The title is rewritten only at 1, 3, 6… events, so the second event keeps it.
        self.assertEqual(result['review']['titles']['T1']['text'], 'Revisão do suporte')
        self.assertEqual([b['id'] for b in result['review']['titles']['T1']['basis']], ['E1'])
        run = meeting(); run['meeting_events'] += [{'event_id':'E2','thread_id':'T1','type':'observation','text':'Outro ponto importante.'},
                                                   {'event_id':'E3','thread_id':'T1','type':'hypothesis','text':'Talvez a base esteja desalinhada.'}]
        self.save(run)
        self.store._run('UPDATE ai_block_requests SET updated_at=0')  # past the 15 s polling guard
        growing = self.blocks.review(self.user, {'session_id':'s1'})
        self.assertEqual(growing['review']['titles']['T1']['text'], 'Revisão do suporte', 'the old title stays visible while the new one is written')
        self.assertEqual(growing['remaining'], 1)
        with patch.object(self.blocks, 'ask', side_effect=self.model): self.runtime.run_once()
        done = self.blocks.review(self.user, {'session_id':'s1'})
        self.assertEqual([b['id'] for b in done['review']['titles']['T1']['basis']], ['E1', 'E2', 'E3'])

    def test_topics_are_written_one_at_a_time_with_their_context_and_continue_in_background(self):
        lines = ['A viga principal apresentou uma flecha de %d mm no ensaio de ontem.' % n for n in range(1, 11)]
        run = {'id': 's1', 'topic_titles': {}, 'meeting_threads': [{'thread_id': 'T1'}, {'thread_id': 'T2'}],
               'meeting_events': [{'event_id': 'E%02d' % n, 'thread_id': 'T1', 'type': 'observation', 'text': text} for n, text in enumerate(lines, 1)]
               + [{'event_id': 'F1', 'thread_id': 'T2', 'type': 'decision', 'text': 'Ficou decidido que a Ana vai cotar o novo sensor de pressão até sexta.'},
                  {'event_id': 'F2', 'thread_id': 'T2', 'type': 'requirement', 'text': 'O sensor precisa operar entre menos dez e cinquenta graus Celsius.'}]}
        self.save(run)
        seen = []
        def answer(user, task, evidence):
            if task == 'edit': seen.append(json.loads(json.dumps(evidence)))
            if task == 'judge': return verdict(evidence, True, 'Fiel.')
            items = [{'id': i['id'], 'text': ('Título ' + i['original'][:20]) if i['kind'] == 'title' else i['original'].replace('A viga principal apresentou', 'Viga principal:').replace(' no ensaio de ontem', ' (ensaio de ontem)')} for i in evidence['items']]
            return {'items': items}
        self.blocks.review(self.user, {'session_id': 's1'})
        with patch.object(self.blocks, 'ask', side_effect=answer) as model:
            while self.runtime.run_once(): pass
        self.assertEqual(model.call_count, 6, 'three topic batches, each with an editor and a critic call, and no room polling')
        self.assertEqual([[i['kind'] for i in e['items']] for e in seen], [['block'] * 8 + ['title'], ['block'] * 2, ['block'] * 2 + ['title']])
        self.assertEqual(seen[0]['topic'], {'title': '', 'context': []})
        self.assertEqual(seen[1]['topic']['title'], 'Título A viga principal apr')
        self.assertEqual(len(seen[1]['topic']['context']), 8)
        self.assertTrue(seen[1]['topic']['context'][0]['text'].startswith('Viga principal:'), 'published notes are the context of the next batch')
        self.assertNotIn('Ficou decidido', json.dumps(seen[:2], ensure_ascii=False), 'another topic never enters the batch')
        result = self.blocks.review(self.user, {'session_id': 's1'})
        self.assertEqual(result['status'], 'ready'); self.assertEqual(len(result['review']['blocks']), 12)
        self.assertEqual(len(result['review']['titles']['T1']['basis']), 6)

    def test_human_rewrites_in_the_meeting_guide_the_style_of_new_notes(self):
        run = meeting()
        run['meeting_events'] += [{'event_id': 'E2', 'thread_id': 'T1', 'type': 'observation', 'text': 'A peça de alumínio trincou perto do furo de fixação depois da montagem.'},
                                  {'event_id': 'E3', 'thread_id': 'T1', 'type': 'observation', 'text': 'O parafuso usado na fixação era de aço inoxidável comum.'}]
        run['block_edits'] = {'E2': {'text': 'Trinca no alumínio, junto ao furo.', 'source': run['meeting_events'][1]['text'], 'at': '2026-10-26T10:00:00Z'},
                              'E3': {'restore': True, 'source': run['meeting_events'][2]['text'], 'at': '2026-10-26T10:01:00Z'},
                              'E9': {'text': 'Outra reunião.', 'source': 'Texto que não existe aqui.', 'at': '2026-10-26T10:02:00Z'}}
        self.save(run)
        seen = []
        def answer(user, task, evidence):
            if task == 'edit': seen.append(evidence)
            return self.model(user, task, evidence)
        self.blocks.review(self.user, {'session_id': 's1'})
        with patch.object(self.blocks, 'ask', side_effect=answer): self.runtime.run_once()
        self.assertEqual(seen[0]['style_examples'], [{'original': run['meeting_events'][1]['text'], 'edited': 'Trinca no alumínio, junto ao furo.'}])

    def test_hidden_low_confidence_speech_is_not_sent_for_notes(self):
        run = meeting(); run['meeting_events'][0]['chunk_id'] = 'C1'
        run['records'] = [{'id': 'C1', 'result': {'storeProbability': .55, 'typeProbability': .9}}]
        self.assertEqual([item['kind'] for item in B.items_for(run)], ['title'])
        run['records'][0]['result']['storeProbability'] = .6
        self.assertEqual([item['kind'] for item in B.items_for(run)], ['block', 'title'])

    def test_classification_corrections_adapt_this_meetings_criteria_and_note_style(self):
        from meetings.engine.meeting_learning import GUIDANCE
        run = meeting(); run['questions'] = {'event_type': {'type': 'choice', 'instructions': 'Classify.', 'criteria': {'observation': 'Describes the current state.', 'decision': 'Explicitly commits to a choice.', 'other': 'Other.'}}}
        self.save(run)
        adapted = {'criteria': {'decision': 'A statement that something was settled in the meeting counts as a decision, even when told as a report.'},
                   'summary': 'Relatos de algo já acertado na reunião passam a contar como decisão.', 'style': 'Notas curtas, começando pelo responsável.'}
        calls = []
        def answer(user, task, evidence):
            calls.append((task, evidence))
            if task == 'learn': return {'label': 'decision', 'rationale': 'A fala registra a decisão.', 'anchors': ['ficou decidido']}
            return adapted
        correction = {'session_id': 's1', 'action': 'correct', 'version': 0, 'event_id': 'E1', 'source': SOURCE, 'label': 'decision', 'summary': SUMMARY, 'note': 'Foi uma decisão.'}
        with patch.object(self.blocks, 'ask', side_effect=answer): learning = self.blocks.learning(self.user, correction)['learning']
        self.assertEqual([task for task, _ in calls], ['learn', 'adapt'])
        self.assertEqual(calls[1][1]['examples'][0]['label'], 'decision'); self.assertEqual(calls[1][1]['criteria']['decision'], 'Explicitly commits to a choice.')
        self.assertEqual(learning['guidance'], adapted['criteria']); self.assertEqual(learning['style'], adapted['style']); self.assertEqual(learning['adapted'], 'llm')
        request = {'model': 'jev-latest', 'state': {'current_utterance': 'Ficou acertado trocar a base.', '_norte_meeting_id': 's1'},
                   'questions': {'event_type': json.loads(json.dumps(run['questions']['event_type']))}}
        updated = self.blocks.apply_learning(self.user, request)['questions']['event_type']['criteria']
        self.assertEqual(updated['decision'], 'Explicitly commits to a choice.' + GUIDANCE + adapted['criteria']['decision'])
        self.assertEqual(updated['observation'], 'Describes the current state.')
        self.assertEqual(request['questions']['event_type']['criteria']['decision'], 'Explicitly commits to a choice.', 'the audited request stays original')
        other = json.loads(json.dumps(request)); other['state']['_norte_meeting_id'] = 's2'
        self.assertEqual(self.blocks.apply_learning(self.user, other)['questions']['event_type']['criteria']['decision'], 'Explicitly commits to a choice.')
        seen = []
        self.blocks.review(self.user, {'session_id': 's1'})
        with patch.object(self.blocks, 'ask', side_effect=lambda u, t, e: (seen.append(e), self.model(u, t, e))[1]): self.runtime.run_once()
        self.assertEqual(seen[0]['style_note'], adapted['style'])
        for invalid in ({'criteria': {'requirement': 'Not touched by any correction.'}, 'summary': '', 'style': ''},
                        {'criteria': {'decision': 'Use 550 kg as a decision.'}, 'summary': '', 'style': ''},
                        {'criteria': {'decision': 'x' * 241}, 'summary': '', 'style': ''},
                        {'criteria': {}, 'summary': 'A precisão subiu 30%.', 'style': ''},
                        {'criteria': {}, 'summary': '', 'style': '', 'commands': ['rm']}):
            self.assertIsNone(self.blocks.learning_store.valid_guidance(invalid, learning['examples'], run['questions']['event_type']['criteria']))
        reverted = self.blocks.learning(self.user, {'session_id': 's1', 'action': 'revert', 'version': 1, 'target_version': 0})['learning']
        self.assertEqual(reverted['examples'], []); self.assertNotIn('guidance', reverted)
        self.assertEqual(self.blocks.apply_learning(self.user, request)['questions']['event_type']['criteria']['decision'], 'Explicitly commits to a choice.')

    def test_structural_guards_and_account_boundary(self):
        for text in ('A carga passou para 30 N.', 'Usar 20 N.', 'Não usar 20 kg.'):
            self.assertFalse(B.safe_summary('Não usar 20 N.', text))
        self.assertFalse(B.safe_summary('Talvez usar 20 N.', 'Usar 20 N.'))
        self.assertTrue(B.safe_summary('Não usar 20 N no suporte.', 'Não usar 20 N.'))
        with self.assertRaises(ValueError): self.blocks.review(self.other, {'session_id':'s1'})
        with self.assertRaises(ValueError): self.blocks.review(self.user, {'session_id':'s1','user_id':self.other})

    def test_editor_rejects_long_wall_of_text_but_accepts_short_bullets(self):
        source = 'Marina revisará o suporte. Ana conferirá o relatório. ' * 8
        self.assertFalse(B.concise_summary(source, source))
        self.assertTrue(B.concise_summary(source, 'Marina revisará o suporte.\nAna conferirá o relatório.'))
        self.assertFalse(B.concise_summary('Usar 20 N. Não ultrapassar 30 N.', 'Usar 30 N.'))
        # Stance markers are welcome; restating the classification is not.
        proposal = 'Então fechamos o desenho hoje e revisamos todo o restante só na semana que vem.'
        self.assertIsNone(B.note_problem(proposal, 'Proposta: fechar o desenho hoje e revisar o restante na semana que vem.'))
        self.assertEqual(B.note_problem(proposal, 'Decisão: fechar o desenho hoje e revisar o restante depois.'), 'label')
        self.assertEqual(B.note_problem(SOURCE, 'Contexto.\n• Requisito: Marina revisará o suporte na sexta-feira.'), 'label')

    def test_classification_learning_is_versioned_scoped_and_reversible(self):
        from meetings.engine.meeting_learning import LABELS
        correction = {'session_id': 's1', 'action': 'correct', 'version': 0, 'event_id': 'E1',
                      'source': SOURCE, 'label': 'decision', 'summary': SUMMARY, 'note': 'Há uma decisão explícita.'}
        with patch.object(self.blocks, 'ask', return_value={'label': 'decision', 'rationale': 'A fala registra a decisão de revisar o suporte.', 'anchors': ['ficou decidido']}) as model:
            result = self.blocks.learning(self.user, correction)
        self.assertEqual(model.call_args.args[1], 'learn')
        self.assertEqual(result['learning']['version'], 1)
        self.assertEqual(result['learning']['examples'][0]['status'], 'llm_reviewed')
        request = {'model': 'jev-latest', 'state': {'current_utterance': 'Decidimos rever a base.', '_norte_meeting_id': 's1'},
                   'questions': {'event_type': {'type': 'choice', 'instructions': 'Classifique a fala.', 'criteria': {label: label for label in LABELS}}}}
        updated = self.blocks.apply_learning(self.user, request)
        self.assertEqual(updated['state']['meeting_feedback']['version'], 1)
        self.assertNotIn('_norte_meeting_id', updated['state'])
        self.assertNotIn('meeting_feedback', request['state'], 'original request must remain auditable')
        self.assertIn('reviewed examples', updated['questions']['event_type']['instructions'])
        self.assertNotIn('meeting_feedback', self.blocks.apply_learning(self.other, request)['state'])
        other_session = json.loads(json.dumps(request)); other_session['state']['_norte_meeting_id'] = 's2'
        self.assertNotIn('meeting_feedback', self.blocks.apply_learning(self.user, other_session)['state'])
        with self.assertRaises(ValueError): self.blocks.learning(self.other, {'session_id': 's1', 'action': 'get'})
        with self.assertRaises(ValueError): self.blocks.learning(self.user, correction)
        reverted = self.blocks.learning(self.user, {'session_id': 's1', 'action': 'revert', 'version': 1, 'target_version': 0})
        self.assertEqual(reverted['learning']['version'], 2)
        self.assertEqual(reverted['learning']['examples'], [])
        self.assertNotIn('meeting_feedback', self.blocks.apply_learning(self.user, request)['state'])

    def test_learning_never_publishes_an_invented_label_or_anchor_as_llm_reviewed(self):
        body = {'session_id': 's1', 'action': 'correct', 'version': 0, 'event_id': 'E1', 'source': SOURCE, 'label': 'decision'}
        with patch.object(self.blocks, 'ask', return_value={'label': 'test_result', 'rationale': 'Teste aprovado.', 'anchors': ['teste aprovado']}):
            result = self.blocks.learning(self.user, body)
        entry = result['learning']['examples'][0]
        self.assertEqual(entry['label'], 'decision')
        self.assertEqual(entry['status'], 'human_example')
        self.assertNotIn('rationale', entry)
        self.assertEqual(self.store.get_record(self.user, B.PREFIX + 's1')[0], json.dumps(meeting()))

    def test_learning_discards_untrusted_context_and_no_longer_applies_after_source_changes(self):
        body = {'session_id': 's1', 'action': 'correct', 'version': 0, 'event_id': 'E1', 'source': SOURCE, 'label': 'decision'}
        with patch.object(self.blocks, 'ask', return_value=None): self.blocks.learning(self.user, body)
        request = {'model': 'jev-latest', 'state': {'current_utterance': 'Decidimos rever a base.', '_norte_meeting_id': 's1', 'meeting_feedback': {'forged': True}},
                   'questions': {'event_type': {'type': 'choice', 'instructions': 'Classifique.', 'criteria': {'decision': 'Decision', 'other': 'Other'}}}}
        self.assertEqual(self.blocks.apply_learning(self.user, request)['state']['meeting_feedback']['version'], 1)
        run = meeting(); run['meeting_events'][0]['text'] = 'Outro trecho.'
        self.store.put_record(self.user, B.PREFIX + 's1', json.dumps(run))
        self.assertNotIn('meeting_feedback', self.blocks.apply_learning(self.user, request)['state'])
        request['state']['_norte_meeting_id'] = ['invalid']
        self.assertNotIn('meeting_feedback', self.blocks.apply_learning(self.user, request)['state'])

    def test_budget_shared_with_existing_agents_and_cost_measured(self):
        self.runtime.settings=dataclasses.replace(self.runtime.settings,ai_daily_call_limit=0)
        with patch.object(ai_runtime.AI_HTTP,'open') as http:
            self.assertIsNone(self.blocks.ask(self.user,'edit',{'items':[]})); http.assert_not_called()
        model=self.runtime.provider_config()[1]
        cost=self.runtime.record_usage(self.user,'gemini',model,'blocks',{'usageMetadata':{'promptTokenCount':1000,'candidatesTokenCount':100,'thoughtsTokenCount':50}},10)
        self.assertAlmostEqual(cost,.000675)
        self.assertEqual(self.blocks.overview()['provider_calls'],1)

    def test_provider_transport_uses_json_and_records_tokens_without_secrets(self):
        payload = {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '{"approved":true,"reason":"Fiel."}'}]}}],
                   'usageMetadata': {'promptTokenCount': 100, 'candidatesTokenCount': 20}}
        with patch.object(ai_runtime.AI_HTTP, 'open') as http:
            http.return_value.__enter__.return_value.read.return_value = json.dumps(payload).encode()
            result = self.blocks.ask(self.user, 'judge', {'items': []})
            request = http.call_args.args[0]
            body = json.loads(request.data)
            self.assertEqual(body['generationConfig']['responseMimeType'], 'application/json')
            self.assertNotIn('user_id', request.data.decode())
            self.assertTrue(result['approved'])
        overview = self.blocks.overview()
        self.assertEqual(overview['provider_calls'], 1); self.assertEqual(overview['unknown_cost_calls'], 0)
        self.assertTrue(self.runtime.provider_status()['verified'])

    def test_unusable_answers_record_why_without_the_text(self):
        cases = [({'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': 'Claro! Aqui está: {"items": ['}]}}]}, 'invalid_json'),
                 ({'candidates': [{'finishReason': 'MAX_TOKENS', 'content': {'parts': [{'text': '{"items": ['}]}}]}, 'MAX_TOKENS'),
                 ({'candidates': ['texto solto']}, 'malformed')]
        for payload, reason in cases:
            with patch.object(ai_runtime.AI_HTTP, 'open') as http:
                http.return_value.__enter__.return_value.read.return_value = json.dumps(payload).encode()
                self.assertIsNone(self.blocks.ask(self.user, 'edit', {'items': []}))
        rows = self.store._run("SELECT status,details FROM ai_usage WHERE lane='blocks' ORDER BY created_at", fetch='all')
        self.assertEqual([json.loads(details)['finish_reason'] for _, details in rows], [reason for _, reason in cases])
        self.assertTrue(all(status == 'success' for status, _ in rows), 'the call was billed even though the answer was unusable')
        self.assertNotIn('Claro', json.dumps(rows))

    def test_one_unusable_editor_answer_is_retried_once_in_the_same_job(self):
        calls = []
        def answer(user, task, evidence):
            calls.append(task)
            return None if calls == ['edit'] else self.model(user, task, evidence)
        self.blocks.review(self.user, {'session_id': 's1'})
        with patch.object(self.blocks, 'ask', side_effect=answer): self.runtime.run_once()
        self.assertEqual(calls, ['edit', 'edit', 'judge'])
        self.assertEqual(self.blocks.review(self.user, {'session_id': 's1'})['review']['blocks']['E1']['text'], SUMMARY)

    def test_http_error_is_sanitized_and_preserves_budget_reservation(self):
        with patch.object(ai_runtime.AI_HTTP, 'open', side_effect=HTTPError('https://example.test', 401, 'SECRET ERROR BODY', {}, None)):
            self.assertIsNone(self.blocks.ask(self.user, 'edit', {'items': []}))
        status = self.runtime.provider_status()
        self.assertEqual(status['last_error']['http_status'], 401)
        self.assertNotIn('SECRET', json.dumps({'provider': status, 'usage': self.store._run('SELECT details FROM ai_usage', fetch='all')}))
        budget = self.store._run('SELECT calls,reserved_usd FROM ai_budget', fetch='one')
        self.assertEqual(budget[0], 1); self.assertGreater(budget[1], 0)
        self.assertEqual(self.blocks.overview()['unknown_cost_calls'], 1)

    def test_timed_out_transport_keeps_slot_until_network_finishes(self):
        release, started = threading.Event(), threading.Event()
        def delayed(*args, **kwargs):
            started.set(); release.wait(2); raise TimeoutError('fixture')
        try:
            with patch.object(ai_runtime.AI_HTTP, 'open', side_effect=delayed) as http:
                self.assertIsNone(self.blocks.ask(self.user, 'edit', {'items': []}, timeout=.01))
                self.assertTrue(started.is_set())
                self.assertIsNone(self.blocks.ask(self.user, 'edit', {'items': []}, timeout=.01))
                self.assertEqual(http.call_count, 1)
        finally:
            release.set()
            self.assertTrue(self.runtime.provider_slots.acquire(timeout=2)); self.runtime.provider_slots.release()


if __name__ == '__main__': unittest.main()
