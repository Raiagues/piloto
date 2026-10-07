/* Versioned semantic contract for the separate Memory V2 workspace. */
(function(root) {
  const questions = {
  "should_store_memory": {
    "type": "noul",
    "instructions": "Does current_utterance state project information or request project work, beyond just managing the conversation? Preparing documents or equipment for the current conversation, without reporting findings or assigning substantive project work, is meeting logistics. Proposing to compare design alternatives is substantive project work even without the words test or measure.",
    "criteria": {
      "true": "Any project fact, fault, hypothesis, test request, measurement request, result, decision, task, requirement, constraint or project question. Proposing a technical test or measurement already establishes project work; full details and an explicit project name are unnecessary.",
      "false": "Only acknowledgments, social talk or coordinating the ongoing meeting: screens, audio, internet, slides, chargers, breaks, asking to repeat spoken words, announcing a topic, or opening a file/report without stating its findings."
    }
  },
  "event_type": {
    "type": "choice",
    "instructions": "Classify the primary project event stated in current_utterance, using only this text. Distinguish an observed condition from evidence produced by testing, a tentative explanation from an investigation to perform, and a test from a committed design choice. Do not invent a test merely because a physical fault is reported. When a measurement reports noncompliance, classify the measured result rather than the quoted requirement. A number alone does not establish a test result: a current baseline metric or numerical design fact is an observation. A test_result must report the outcome of a test, measurement or evaluation that the utterance says was performed. Clarifying the intended meaning or scope of a specification is a requirement, even without a modal verb such as must. Classify the act being requested: preparation or implementation work is a non-test task even when it is a prerequisite for testing.",
    "criteria": {
      "observation": "Describes the current state of the project: a fact, baseline metric, existing design property, fault or recurring damage. Numerical values can describe the current state; without a stated test, measurement or evaluation being performed, they remain observations.",
      "hypothesis": "Suggests an unverified cause, explanation or conditional possibility, including a conjecture that a failure may occur only under a certain condition; no concrete investigation or final choice is established.",
      "test_proposal": "Requests or proposes an investigation, experiment, prototype test, measurement, validation or comparison, including rerunning a test. A test instruction is a test_proposal even when its object is an indirect reference.",
      "test_result": "Reports the outcome of a performed test, experiment, measurement, validation or evaluated intervention. The utterance identifies the testing/measurement activity or explicitly reports its result. A current-state metric or numerical design fact without that evaluation context is an observation.",
      "decision": "Explicitly commits to, selects, approves or rejects a project choice. Choosing a version for adoption differs from proposing to test it.",
      "requirement": "States or clarifies a required property, acceptance criterion, constraint, specification or limit that must hold. This differs from requesting a concrete preparatory or implementation task, which is other. An imperative can still be a requirement when it states a constraint rather than assigning work.",
      "other": "Other useful project information, especially a concrete non-investigative task (preparation, implementation or delivery), an unresolved project question or a risk not covered above. Work required before testing remains a task unless it itself investigates something."
    }
  }
};
  const threadConfig = {
    "questions": {
      "belongs_to_active_thread": {
        "type": "choice",
        "instructions": "Compare the subject named in current_event with the subject of active_thread.events. An explicit return to another subject does not belong to this thread. Does current_event continue the discussion in active_thread.events? First, a requirement or limit that names no subject is uncertain: do not fill in its subject from adjacent utterances. For other events, identify the subject and overall problem from the beginning of the thread. Use recent_context to resolve indirect references and changes of subject. Repeating or rescheduling an earlier test continues that discussion. Trying another parameter or suspected cause on the same subject also continues it; a thread is not limited to one test variable. A fact or requirement explicitly scoped to that subject adds background or a design constraint, even if that property was not mentioned before. Distinguish a new independent failure/problem from a new way to investigate the original problem. Thread membership is about the investigation, not equality of test setups. A decision explicitly based on this investigation's evidence continues it, including adoption in a future prototype. A report about its named trial continues it even if its setup is unresolved.",
        "criteria": {
          "belongs": "Continues or returns to this discussion: same identified subject and investigation, another explanation or test variation, repetition of its test, or a fact/constraint explicitly scoped to its subject. A changed test parameter or an added design constraint does not create a separate investigation. If a component has separate investigations, the requirement must identify this line of work by scope or test condition.",
          "does_not_belong": "Explicitly changes to another subject or independent problem. A separately introduced failure mode or investigation is a different thread even if the same component is involved. A different test variable within the original problem is not an independent problem. A requirement whose scope or test condition identifies another investigation also excludes this thread, even on the same component.",
          "uncertain": "No identifiable subject or insufficient evidence for either a continuation or a different discussion. An unscoped requirement is uncertain, even if only one design was recently discussed."
        }
      },
      "belongs_to_archive_thread": {
        "type": "choice",
        "instructions": "Does current_event continue the discussion in candidate_thread.events? First, a requirement or limit that names no subject is uncertain: do not fill in its subject from adjacent utterances. For other events, identify the subject and overall problem from the beginning of the thread. Use recent_context to resolve indirect references and changes of subject. Repeating or rescheduling an earlier test continues that discussion. Trying another parameter or suspected cause on the same subject also continues it; a thread is not limited to one test variable. A fact or requirement explicitly scoped to that subject adds background or a design constraint, even if that property was not mentioned before. Distinguish a new independent failure/problem from a new way to investigate the original problem. Thread membership is about the investigation, not equality of test setups. A decision explicitly based on this investigation's evidence continues it, including adoption in a future prototype. A report about its named trial continues it even if its setup is unresolved. For a requirement on a shared component, use the stated problem, purpose or test condition to distinguish its investigations. A constraint scoped to a different investigation does not belong to this candidate.",
        "criteria": {
          "belongs": "Continues or returns to this discussion: same identified subject and investigation, another explanation or test variation, repetition of its test, or a fact/constraint explicitly scoped to its subject. A changed test parameter or an added design constraint does not create a separate investigation. If a component has separate investigations, the requirement must identify this line of work by scope or test condition.",
          "does_not_belong": "Explicitly changes to another subject or independent problem. A separately introduced failure mode or investigation is a different thread even if the same component is involved. A different test variable within the original problem is not an independent problem. A requirement whose scope or test condition identifies another investigation also excludes this thread, even on the same component.",
          "uncertain": "No identifiable subject or insufficient evidence for either a continuation or a different discussion. An unscoped requirement is uncertain, even if only one design was recently discussed."
        }
      }
    }
  };
  // Reviewed source: tests/fixtures/memory-b002-reviewed.json.
  const example = {
    "batch_id": "B002-REVIEWED",
    "cases": [
      {
        "id": "C01",
        "current_utterance": "The bracket is deforming too much.",
        "expected_store_memory": true,
        "expected_event_type": "observation"
      },
      {
        "id": "C02",
        "current_utterance": "Yeah.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C03",
        "current_utterance": "The current bracket is 3 mm aluminum.",
        "expected_store_memory": true,
        "expected_event_type": "observation"
      },
      {
        "id": "C04",
        "current_utterance": "Maybe the thickness is causing the problem.",
        "expected_store_memory": true,
        "expected_event_type": "hypothesis"
      },
      {
        "id": "C05",
        "current_utterance": "Okay, that makes sense.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C06",
        "current_utterance": "Let's test a 4 mm version.",
        "expected_store_memory": true,
        "expected_event_type": "test_proposal"
      },
      {
        "id": "C07",
        "current_utterance": "Can you repeat that?",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C08",
        "current_utterance": "In the deformation test, the 4 mm version still exceeded the deformation limit.",
        "expected_store_memory": true,
        "expected_event_type": "test_result"
      },
      {
        "id": "C09",
        "current_utterance": "Please run that test again this afternoon.",
        "expected_store_memory": true,
        "expected_event_type": "test_proposal"
      },
      {
        "id": "C10",
        "current_utterance": "We have decided to use the 4 mm version in the next prototype.",
        "expected_store_memory": true,
        "expected_event_type": "decision"
      },
      {
        "id": "C11",
        "current_utterance": "I will reconnect in one minute.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C12",
        "current_utterance": "The client requires a safety factor of two.",
        "expected_store_memory": true,
        "expected_event_type": "requirement"
      },
      {
        "id": "C13",
        "current_utterance": "Maybe the support stiffness is the real issue.",
        "expected_store_memory": true,
        "expected_event_type": "hypothesis"
      },
      {
        "id": "C14",
        "current_utterance": "Let's test the support condition next.",
        "expected_store_memory": true,
        "expected_event_type": "test_proposal"
      },
      {
        "id": "C15",
        "current_utterance": "We tested the 4 mm version and it still exceeded the deformation limit.",
        "expected_store_memory": true,
        "expected_event_type": "test_result"
      },
      {
        "id": "C16",
        "current_utterance": "Now let's discuss the sensor enclosure.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C17",
        "current_utterance": "The sensor enclosure wall is cracking near the mounting holes.",
        "expected_store_memory": true,
        "expected_event_type": "observation"
      },
      {
        "id": "C18",
        "current_utterance": "Can everyone see my screen?",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C19",
        "current_utterance": "Maybe the mounting-hole spacing is concentrating the stress.",
        "expected_store_memory": true,
        "expected_event_type": "hypothesis"
      },
      {
        "id": "C20",
        "current_utterance": "Yeah, I can see it now.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C21",
        "current_utterance": "Let's test a version with wider hole spacing.",
        "expected_store_memory": true,
        "expected_event_type": "test_proposal"
      },
      {
        "id": "C22",
        "current_utterance": "In the test with wider hole spacing, the sensor enclosure no longer cracked.",
        "expected_store_memory": true,
        "expected_event_type": "test_result"
      },
      {
        "id": "C23",
        "current_utterance": "Give me a second, I need to grab my charger.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C24",
        "current_utterance": "Going back to the bracket, the 4 mm rerun still exceeded the deformation limit.",
        "expected_store_memory": true,
        "expected_event_type": "test_result"
      },
      {
        "id": "C25",
        "current_utterance": "Sorry, my audio cut out for a second.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C26",
        "current_utterance": "For the sensor enclosure, let's test a 4 mm wall.",
        "expected_store_memory": true,
        "expected_event_type": "test_proposal"
      },
      {
        "id": "C27",
        "current_utterance": "The client also requires a maximum mass of 2 kg.",
        "expected_store_memory": true,
        "expected_event_type": "requirement"
      },
      {
        "id": "C28",
        "current_utterance": "By the way, lunch is in the conference room.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C29",
        "current_utterance": "That 2 kg limit applies to the sensor enclosure.",
        "expected_store_memory": true,
        "expected_event_type": "requirement"
      },
      {
        "id": "C30",
        "current_utterance": "Separately, the bracket coating is failing the salt-spray test.",
        "expected_store_memory": true,
        "expected_event_type": "test_result"
      },
      {
        "id": "C31",
        "current_utterance": "Give me a second, I'm opening the coating report.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C32",
        "current_utterance": "Maybe the coating thickness is too low.",
        "expected_store_memory": true,
        "expected_event_type": "hypothesis"
      },
      {
        "id": "C33",
        "current_utterance": "Let's measure the coating thickness.",
        "expected_store_memory": true,
        "expected_event_type": "test_proposal"
      },
      {
        "id": "C34",
        "current_utterance": "I can't see the slides because the meeting-room projector is disconnected.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C35",
        "current_utterance": "We measured the coating at 18 microns, below the required 25.",
        "expected_store_memory": true,
        "expected_event_type": "test_result"
      },
      {
        "id": "C36",
        "current_utterance": "Back to the bracket deformation, let's test the support stiffness under the same load.",
        "expected_store_memory": true,
        "expected_event_type": "test_proposal"
      },
      {
        "id": "C37",
        "current_utterance": "Can we take a five-minute break after this?",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C38",
        "current_utterance": "For the sensor enclosure, the 4 mm wall cracked again.",
        "expected_store_memory": true,
        "expected_event_type": "observation"
      },
      {
        "id": "C39",
        "current_utterance": "The sensor enclosure must remain under 2 kg.",
        "expected_store_memory": true,
        "expected_event_type": "requirement"
      },
      {
        "id": "C40",
        "current_utterance": "The bracket must maintain a safety factor of two under the test load.",
        "expected_store_memory": true,
        "expected_event_type": "requirement"
      },
      {
        "id": "C41",
        "current_utterance": "Okay.",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C42",
        "current_utterance": "Did anyone see the game last night?",
        "expected_store_memory": false,
        "expected_event_type": null
      },
      {
        "id": "C43",
        "current_utterance": "Let's run the support-stiffness test under the same load tomorrow morning.",
        "expected_store_memory": true,
        "expected_event_type": "test_proposal"
      }
    ],
    "expected_threads": {
      "C01": {
        "expected_action": "create_new_thread",
        "expected_thread_id": "T001"
      },
      "C03": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T001"
      },
      "C04": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T001"
      },
      "C06": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T001"
      },
      "C08": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T001"
      },
      "C09": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T001"
      },
      "C10": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T001"
      },
      "C12": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "uncertain",
        "expected_archive_results": {},
        "expected_action": "assignment_pending",
        "expected_thread_id": null
      },
      "C13": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "belongs",
        "expected_archive_results": {},
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T001"
      },
      "C14": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T001"
      },
      "C15": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T001"
      },
      "C17": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "does_not_belong",
        "expected_archive_results": {},
        "expected_action": "create_new_thread",
        "expected_thread_id": "T002"
      },
      "C19": {
        "expected_active_thread_id": "T002",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T002"
      },
      "C21": {
        "expected_active_thread_id": "T002",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T002"
      },
      "C22": {
        "expected_active_thread_id": "T002",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T002"
      },
      "C24": {
        "expected_active_thread_id": "T002",
        "expected_active_result": "does_not_belong",
        "expected_archive_results": {
          "T001": "belongs"
        },
        "expected_action": "reactivate_thread",
        "expected_thread_id": "T001"
      },
      "C26": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "does_not_belong",
        "expected_archive_results": {
          "T002": "belongs"
        },
        "expected_action": "reactivate_thread",
        "expected_thread_id": "T002"
      },
      "C27": {
        "expected_active_thread_id": "T002",
        "expected_active_result": "uncertain",
        "expected_archive_results": {
          "T001": "uncertain"
        },
        "expected_action": "assignment_pending",
        "expected_thread_id": null
      },
      "C29": {
        "expected_active_thread_id": "T002",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T002"
      },
      "C30": {
        "expected_active_thread_id": "T002",
        "expected_active_result": "does_not_belong",
        "expected_archive_results": {
          "T001": "does_not_belong"
        },
        "expected_action": "create_new_thread",
        "expected_thread_id": "T003"
      },
      "C32": {
        "expected_active_thread_id": "T003",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T003"
      },
      "C33": {
        "expected_active_thread_id": "T003",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T003"
      },
      "C35": {
        "expected_active_thread_id": "T003",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T003"
      },
      "C36": {
        "expected_active_thread_id": "T003",
        "expected_active_result": "does_not_belong",
        "expected_archive_results": {
          "T001": "belongs",
          "T002": "does_not_belong"
        },
        "expected_action": "reactivate_thread",
        "expected_thread_id": "T001"
      },
      "C38": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "does_not_belong",
        "expected_archive_results": {
          "T002": "belongs",
          "T003": "does_not_belong"
        },
        "expected_action": "reactivate_thread",
        "expected_thread_id": "T002"
      },
      "C39": {
        "expected_active_thread_id": "T002",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T002"
      },
      "C40": {
        "expected_active_thread_id": "T002",
        "expected_active_result": "does_not_belong",
        "expected_archive_results": {
          "T001": "belongs",
          "T003": "does_not_belong"
        },
        "expected_action": "reactivate_thread",
        "expected_thread_id": "T001"
      },
      "C43": {
        "expected_active_thread_id": "T001",
        "expected_active_result": "belongs",
        "expected_action": "keep_active_thread",
        "expected_thread_id": "T001"
      }
    },
    "review_notes": {
      "baseline": "memory-b002-original.json preserves the supplied B002 cases and expectations.",
      "classification_scope": "Memory retention and event type use only current_utterance. Thread membership uses prior conversational context. A prior test proposal alone must not change an isolated observation into a test result.",
      "changes": [
        {
          "case_id": "C08",
          "field": "current_utterance",
          "reason": "Makes the experiment explicit so test_result is justified by the utterance alone."
        },
        {
          "case_id": "C22",
          "field": "current_utterance",
          "reason": "Makes the experiment explicit so test_result is justified by the utterance alone."
        },
        {
          "case_id": "C13",
          "field": "expected_action",
          "old": "assign_active_thread",
          "new": "keep_active_thread",
          "reason": "A pending event does not remove or replace the active thread; T001 remains active after C12."
        }
      ],
      "retained_expectations": [
        {
          "case_id": "C38",
          "reason": "The utterance reports a crack without saying it occurred in an experiment; observation follows isolated classification even though C26 proposed a test."
        },
        {
          "case_id": "C27",
          "reason": "The requirement names no subject. Under the explicit conservative routing policy, adjacency alone does not identify the enclosure."
        },
        {
          "case_id": "C29",
          "reason": "This new event explicitly identifies the enclosure and belongs to T002. Any later resolution of C27 must preserve its initially pending result."
        }
      ]
    }
  };
  const api = {questions, threadConfig, threadSchemaVersion:5, example};
  if(typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.NorteMemoryV2=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
