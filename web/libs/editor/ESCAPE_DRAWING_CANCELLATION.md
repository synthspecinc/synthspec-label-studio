# Escape drawing cancellation (TOOL-32)

Rectangle and polygon image drawing tools treat Escape as cancellation, whether
the tool is idle or has an unfinished region. Cancellation removes only the
draft region, clears tool-local pointer or click state, returns to the Move tool,
and leaves completed regions unchanged.

The drawing transaction freezes annotation history while a draft is live and
temporarily pauses autosave. Successful completion commits the frozen changes as
one history entry. Cancellation first reverts the draft, then discards the
frozen transaction in a separate model action so the final MobX State Tree
snapshot cannot create an orphan undo state or trigger autosave.

Tool switches and annotation switches use the same model-level cancellation
path. Relation linking keeps precedence over drawing cancellation, and keyboard
events owned by inputs or modal UI continue to be filtered by the existing
hotkey layer. Annotation navigation defers only the history-freeze release by
one microtask so the outer MobX State Tree action flushes the reverted snapshot
before history resumes.

This behavior is intentionally limited to image rectangle and polygon drawing
tools and their label variants. It does not change completion behavior for
unrelated media or vector tools.
