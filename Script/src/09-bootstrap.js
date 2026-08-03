function waitForTimetablePage() {
  const selectors = [".timetablepage", ".timetable", "#toolbar"];
  const found = selectors.some((sel) => document.querySelector(sel));
  if (found) {
    mountUi();
    return;
  }

  const observer = new MutationObserver(() => {
    if (selectors.some((sel) => document.querySelector(sel))) {
      observer.disconnect();
      mountUi();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Also mount a floating panel after timeout so settings remain reachable on non-timetable pages.
  window.setTimeout(() => {
    if (!document.getElementById(UI_ID)) mountUi();
  }, 5000);
}

waitForTimetablePage();
