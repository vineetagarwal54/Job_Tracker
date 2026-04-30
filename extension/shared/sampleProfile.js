// Temporary hardcoded profile used during Phase 3 development.
// Later, this should be replaced by real JobTrack profile data through
// native messaging or another extension-to-app bridge.
//
// Keys must match the category ids emitted by shared/fieldMatcher.js.

export const SAMPLE_PROFILE = {
  // Basic identity
  firstName: "Vineet",
  lastName: "Agarwal",
  fullName: "Vineet Agarwal",
  email: "vineetagarwal540@gmail.com",
  phone: "1234567890",

  // Address and location
  country: "United States",
  address: "College Park, MD",
  addressLine1: "College Park, MD",
  addressLine2: "",
  city: "College Park",
  state: "Maryland",
  stateCode: "MD",
  zip: "20742",
  postalCode: "20742",
  currentLocation: "College Park, Maryland",

  // Online profiles
  linkedinUrl: "https://www.linkedin.com/in/vineet-agarwal54",
  githubUrl: "https://github.com/vineetagarwal54",
  portfolioUrl: "https://vineet-agarwal54.vercel.app",
  personalWebsite: "https://vineet-agarwal54.vercel.app",
  otherWebsite: "https://vineet-agarwal54.vercel.app",

  // Work eligibility
  earliestStartDate: "May 19, 2026",
  workAuthorization: "yes",
  sponsorship: "no",
  requireSponsorship: "no",
  futureSponsorship: "no",
  locationRequirement: "Yes",
  relocation: "Yes",
  stateResidency: "No",
  ageOver18: "Yes",

  // Application history / source
  previouslyApplied: "No",
  previouslyEmployed: "No",
  referralName: "",
  source: "LinkedIn",

  // EEO / voluntary self-identification
  gender: "Male",
  race: "Asian",
  hispanicLatino: "No",
  veteranStatus: "I am not a protected veteran",
  disabilityStatus: "No, I do not have a disability",

  // Optional demographic fields
  pronouns: "",
};

// Categories whose planned value should be treated as yes/no.
// The fill engine can type these into text boxes or match equivalent
// dropdown/radio options.
export const YES_NO_CATEGORIES = new Set([
  "workAuthorization",
  "sponsorship",
  "requireSponsorship",
  "futureSponsorship",
  "locationRequirement",
  "relocation",
  "stateResidency",
  "ageOver18",
  "previouslyApplied",
  "previouslyEmployed",
  "hispanicLatino",
]);