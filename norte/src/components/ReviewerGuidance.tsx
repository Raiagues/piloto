export function ReviewerGuidance({ pt, demo = false, hasExamples = false, hasReviewer }: { pt: boolean; demo?: boolean; hasExamples?: boolean; hasReviewer: boolean }) {
  if (demo || hasExamples) return <p className="delivery-note reviewer-guidance">{pt
    ? 'Perfis EXEMPLO ilustram a equipe e não fazem aprovações. Para testar uma revisão entre duas pessoas, use duas contas normais e aceite o convite para a mesma equipe.'
    : 'EXAMPLE profiles illustrate the team and cannot approve changes. To test a review between two people, use two registered accounts and accept an invitation to the same team.'}</p>;
  if (hasReviewer) return null;
  return <p className="delivery-note reviewer-guidance">{pt ? 'A revisão precisa de outra pessoa com acesso ao projeto. ' : 'Review requires another person with project access. '}<a href="#/project-team">{pt ? 'Convidar participante →' : 'Invite participant →'}</a></p>;
}
