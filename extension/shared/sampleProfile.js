// Temporary hardcoded profile used during Phase 3 development. The eventual
// integration reads real profiles from JobTrack via native messaging — this
// module exists only to prove the autofill plumbing end-to-end without
// touching the Electron app.
//
// Keys mirror the category ids emitted by `classifyField` (see
// shared/fieldMatcher.js) so a profile lookup is just `profile[category]`.
//
// Yes/No fields (workAuthorization, sponsorship, locationRequirement,
// stateResidency) store the lowercase canonical answer. The fill engine
// title-cases for free-text inputs and matches options for select/radio.

export const SAMPLE_PROFILE = {
  firstName: "Vineet",
  lastName: "Agarwal",
  email: "vineetagarwal540@gmail.com",
  phone: "1234567890",
  country: "United States",
  address: "College Park, MD",
  city: "College Park",
  state: "Maryland",
  zip: "20742",
  currentLocation: "College Park, Maryland",
  earliestStartDate: "May 19, 2026",
  workAuthorization: "yes",
  sponsorship: "no",
  locationRequirement: "Yes",
  stateResidency: "No",
  gender: "Prefer not to say",
  race: "Prefer not to say",
  hispanicLatino: "No",
  veteranStatus: "I am not a protected veteran",
  disabilityStatus: "No, I do not have a disability"
};

// Categories whose plan value should be normalized as yes/no. The fill
// engine title-cases for text inputs and uses synonym matching for
// selects/radios.
export const YES_NO_CATEGORIES = new Set([
  "workAuthorization",
  "sponsorship",
  "locationRequirement",
  "stateResidency",
]);
