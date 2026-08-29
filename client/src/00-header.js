// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — Client half (installed package bundle entry, zero-build).
 *
 * Registered through window.__ModuleLoader__ like every web client bundle;
 * `react` and the UI primitives resolve from the browser module table via the
 * injected require. Everything else is inlined plain JavaScript.
 *
 * UI surface:
 *  - a "Tacit" tab in the conversation view ring (`conversation.view`
 *    slot, beside Chat/Trajectory) listing every turn's digest with an
 *    Analyze button and the analysis report;
 *  - a small ✨ Improve button in the composer tool row
 *    (`conversation.input.left`) while it is enabled in Settings;
 *  - a before/after preview popup in `conversation.input.overlay` whose
 *    Apply action replaces the composer draft via `inputActions.setDraft`.
 *
 * Data plane: the host half pushes the trajectory digest through the
 * harness's session-projection pipeline (`tacitTimeline`, read with the
 * standard `useProjection` prop) and serves the model calls over the
 * plugin's own /api/tacit/* JSON routes on the harness web server.
 * No custom server, no bundled zod, no secrets on this side.
 */

// Non-browser imports are a no-op (the harness loads this bundle in the
// browser only; the guard also keeps Node-based tests of this file safe).
if (typeof window === 'undefined' || window.__ModuleLoader__ === undefined || typeof window.__ModuleLoader__.load !== 'function') {
  // eslint-disable-next-line no-void
  void 0
} else window.__ModuleLoader__.load({
  id: 'dsh-tacit',
  factory: (require) => {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const MarkdownText = primitives !== undefined && primitives.MarkdownText !== undefined
      ? primitives.MarkdownText
      : null
    const h = React.createElement
    const { useState, useEffect } = React

    const NS = 'dsh-tacit'

