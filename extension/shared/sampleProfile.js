// Temporary hardcoded profile used during Phase 3 development.
// Later, this should be replaced by real JobTrack profile data through
// native messaging or another extension-to-app bridge.
//
// Keys must match the category ids emitted by shared/fieldMatcher.js, OR be
// referenced from a category's profileKey override in fieldCategories.js.

import { YES_NO_CATEGORIES as REGISTRY_YES_NO } from "./fieldCategories.js";

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

  // Education
  educationStartDate: "August 2024",
  educationEndDate: "December 2026",
  expectedGraduationDate: "December 2026",
  graduationDate: "December 2026",
  gpa: "3.5",
  currentGpa: "3.5",
  educationSchoolName: "University of Maryland, College Park",
  schoolName: "University of Maryland, College Park",
  universityName: "University of Maryland, College Park",

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

// Re-export the canonical yes/no set so existing callers (sidepanel.js)
// don't have to switch their import path. The source of truth lives in
// fieldCategories.js (derived from each category's expectedType).
export const YES_NO_CATEGORIES = REGISTRY_YES_NO;
