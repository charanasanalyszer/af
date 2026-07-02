/* ══════════════════════════════════════════════════════════════════
   ui-helpers.js — small, dependency-free helpers for the UI refresh.
   Kept separate from script.js on purpose: it only adds optional
   sugar on top of existing markup/classes and never touches app logic,
   so it can't break anything already working in script.js.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  /**
   * Toggle a spinner + disabled state on a button.
   * uiBtnLoading(btnEl_or_selector, true)  -> shows spinner, disables
   * uiBtnLoading(btnEl_or_selector, false) -> restores original label
   */
  function uiBtnLoading(target, isLoading) {
    var btn = typeof target === "string" ? document.querySelector(target) : target;
    if (!btn) return;
    if (isLoading) {
      if (!btn.hasAttribute("data-ui-label")) btn.setAttribute("data-ui-label", btn.innerHTML);
      btn.classList.add("is-loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("is-loading");
      btn.disabled = false;
      var original = btn.getAttribute("data-ui-label");
      if (original != null) btn.innerHTML = original;
    }
  }

  /**
   * Render a centered spinner + label into a container while something loads.
   * uiLoadingBlock('#someDiv', 'Generating merit list…')
   */
  function uiLoadingBlock(target, label, sub) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    el.innerHTML =
      '<div class="ui-loading-block">' +
        '<div class="ui-spinner ui-spinner-lg"></div>' +
        '<div class="ui-loading-label">' + (label || "Loading…") + '</div>' +
        (sub ? '<div class="ui-loading-sub">' + sub + '</div>' : '') +
      '</div>';
  }

  /**
   * Render skeleton placeholder rows into a container while data loads.
   * uiSkeletonRows('#tableBody', 5)
   */
  function uiSkeletonRows(target, count) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    var n = count || 4;
    var html = "";
    for (var i = 0; i < n; i++) {
      html +=
        '<div class="skel-row">' +
          '<div class="skel skel-avatar"></div>' +
          '<div style="flex:1">' +
            '<div class="skel skel-text w-60"></div>' +
            '<div class="skel skel-text w-40"></div>' +
          '</div>' +
        '</div>';
    }
    el.innerHTML = html;
  }

  /** Skeleton placeholders for the dashboard stat-row while first data loads. */
  function uiSkeletonStats(target, count) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return;
    var n = count || 4;
    var html = '<div class="skel-stat-row">';
    for (var i = 0; i < n; i++) html += '<div class="skel skel-card"></div>';
    html += '</div>';
    el.innerHTML = html;
  }

  global.uiBtnLoading = uiBtnLoading;
  global.uiLoadingBlock = uiLoadingBlock;
  global.uiSkeletonRows = uiSkeletonRows;
  global.uiSkeletonStats = uiSkeletonStats;
})(window);
