/* Personal notes for later correction. They are stored beside the meeting, shown only
 * to their author and stay outside the run, the minutes and model requests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorteMeetingNotes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Same interface as the bridge's account notes, for a room without an account. */
  function localStore(db, meetingId) {
    const key = 'norte.meeting-room.notes.v1.' + meetingId;
    const list = async () => JSON.parse((await db.read(key)) || '[]');
    const save = notes => db.write(key, JSON.stringify(notes));
    return {
      list,
      async add({ text, offsetMs }) {
        const note = {
          id: 'N' + Date.now().toString(36),
          text,
          offsetMs,
          done: false,
          createdAt: new Date().toISOString(),
        };
        await save([...(await list()), note]);
        return note;
      },
      async update(id, done) {
        const notes = await list(),
          note = notes.find(item => item.id === id);
        note.done = done;
        await save(notes);
        return note;
      },
      async remove(id) {
        await save((await list()).filter(item => item.id !== id));
      },
    };
  }

  /** Index of the last turn said before each note; -1 places the note above the first turn. */
  function placeNotes(turns, notes) {
    const placed = new Map();
    for (const note of notes) {
      let index = -1;
      turns.forEach((turn, position) => {
        if ((turn.offsetMs ?? 0) <= (note.offsetMs ?? Infinity)) index = position;
      });
      placed.set(index, [...(placed.get(index) || []), note]);
    }
    return placed;
  }

  return { localStore, placeNotes };
});
