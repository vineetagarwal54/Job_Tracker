// Clearly fake data for explicit development-only fallback testing.
//
// Keys must match the category ids emitted by shared/fieldMatcher.js, OR be
// referenced from a category's profileKey override in fieldCategories.js.

import { YES_NO_CATEGORIES as REGISTRY_YES_NO } from "./fieldCategories.js";

export const SAMPLE_PROFILE = {
  // Basic identity
  firstName: "Dev",
  lastName: "Example",
  fullName: "Dev Example",
  email: "dev.example@example.test",
  phone: "+1 555 010 0199",

  // Address and location
  country: "United States",
  address: "123 Example Avenue",
  addressLine1: "123 Example Avenue",
  addressLine2: "",
  city: "Exampleville",
  state: "Example State",
  stateCode: "EX",
  zip: "00000",
  postalCode: "00000",
  currentLocation: "Exampleville, Example State",

  // Online profiles
  linkedinUrl: "https://www.linkedin.com/in/example-dev",
  githubUrl: "https://github.com/example-dev",
  portfolioUrl: "https://example.test/portfolio",
  personalWebsite: "https://example.test/portfolio",
  otherWebsite: "https://example.test/portfolio",

  // Work eligibility
  earliestStartDate: "January 1, 2099",
  workAuthorization: "yes",
  sponsorship: "no",
  requireSponsorship: "no",
  futureSponsorship: "no",
  locationRequirement: "Yes",
  relocation: "Yes",
  stateResidency: "No",
  ageOver18: "Yes",

  // Education
  educationStartDate: "January 2090",
  educationEndDate: "December 2094",
  expectedGraduationDate: "December 2094",
  graduationDate: "December 2094",
  gpa: "4.0",
  currentGpa: "4.0",
  educationSchoolName: "Example Technical Institute",
  schoolName: "Example Technical Institute",
  universityName: "Example Technical Institute",

  // Application history / source
  previouslyApplied: "No",
  previouslyEmployed: "No",
  referralName: "",
  source: "LinkedIn",

  // EEO / voluntary self-identification
  gender: "Prefer not to say",
  race: "Prefer not to say",
  hispanicLatino: "Prefer not to say",
  veteranStatus: "Prefer not to say",
  disabilityStatus: "Prefer not to say",

  // Optional demographic fields
  pronouns: "",
};

// Re-export the canonical yes/no set so existing callers (sidepanel.js)
// don't have to switch their import path. The source of truth lives in
// fieldCategories.js (derived from each category's expectedType).
export const YES_NO_CATEGORIES = REGISTRY_YES_NO;
