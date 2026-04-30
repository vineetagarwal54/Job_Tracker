(() => {
  const root = globalThis;

  if (!root.JobTrackAutofill) {
    root.JobTrackAutofill = {
      version: "phase-3.1",
      utils: {},
      matchers: {},
      locators: {},
      fillers: {},
    };
  }

  if (!root.JobTrackAutofill.utils) root.JobTrackAutofill.utils = {};
  if (!root.JobTrackAutofill.matchers) root.JobTrackAutofill.matchers = {};
  if (!root.JobTrackAutofill.locators) root.JobTrackAutofill.locators = {};
  if (!root.JobTrackAutofill.fillers) root.JobTrackAutofill.fillers = {};
})();