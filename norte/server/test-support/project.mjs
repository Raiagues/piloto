import { DEFAULT_PROJECT_ROLES } from '../data-store.mjs';
export function createValidationProject(timestamp = new Date().toISOString()) {
  return {schemaVersion:2,id:'fixture-project',name:'Engineering fixture',createdAt:timestamp,updatedAt:timestamp,
    context:{configured:true,teamId:null,teamName:'',roles:structuredClone(DEFAULT_PROJECT_ROLES),sectors:[],folders:[],assignments:[],teamArtifactIds:[],projectArtifactIds:[]},
    setup:{intent:'problem',statement:'',framework:'norte-core',references:[]},board:{nodes:[],links:[]},
    navigation:{lastRoute:'requirements'},phaseProgress:{highestUnlockedStep:0},memoryRevision:1,progress:{mode:'standard',customCriteria:[]},studies:[],resolvedIssueKeys:[],templates:{activeTemplateId:'norte-core-v1',lockedPaths:[]}};
}
