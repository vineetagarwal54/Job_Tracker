// Classifies a raw detected field into one of the JobTrack profile categories
// and decorates it with metadata for the side panel and autofill planner.
//
// Phase 3.1 goal:
// - Keep detection generalized, not company-specific.
// - Expand common application fields such as LinkedIn, GitHub, portfolio,
//   website, relocation, referral, source, and application history.
// - Keep review/sensitive flags as UI warnings only; sidepanel.js decides
//   whether a field is fillable.

export const CATEGORIES = [
  // ── Online profile / links ──────────────────────────────────────────
  {
    id: "linkedinUrl",
    phrases: [
      "linkedin profile url",
      "linkedin profile",
      "linkedin url",
      "linkedin link",
      "linkedin",
    ],
    keywords: ["linkedin", "linked in"],
  },
  {
    id: "githubUrl",
    phrases: [
      "github profile url",
      "github profile",
      "github url",
      "github link",
      "github",
      "git hub",
    ],
    keywords: ["github", "git hub"],
  },
  {
    id: "portfolioUrl",
    phrases: [
      "portfolio website url",
      "portfolio website",
      "portfolio url",
      "portfolio link",
      "personal portfolio",
      "project portfolio",
      "portfolio",
    ],
    keywords: ["portfolio"],
  },
  {
    id: "personalWebsite",
    phrases: [
      "personal website url",
      "personal website",
      "personal site",
      "website url",
      "website link",
      "your website",
      "website",
    ],
    keywords: ["website", "personal site", "url"],
  },
  {
    id: "otherWebsite",
    phrases: [
      "other website url",
      "other website",
      "other links",
      "other link",
      "additional website",
      "additional links",
      "additional link",
      "links you would like to share",
      "anything else you would like to share",
    ],
    keywords: ["other website", "other link", "additional link"],
  },

  // ── Work eligibility / application questions ────────────────────────
  {
    id: "earliestStartDate",
    phrases: [
      "soonest date you can start",
      "soonest you can start",
      "earliest date you can start",
      "earliest possible start date",
      "earliest start date",
      "available start date",
      "availability date",
      "when can you start",
      "what is your start date",
      "start date",
    ],
  },
  {
    id: "workAuthorization",
    phrases: [
      "legally authorized to work in the united states",
      "authorized to work in the united states",
      "authorized to work in the us",
      "authorized to work in the u s",
      "legally authorized to work",
      "eligible to work in the united states",
      "eligible to work in the us",
      "eligible to work",
      "work authorization",
      "authorization to work",
      "right to work",
      "right to work in",
    ],
  },
  {
    id: "sponsorship",
    phrases: [
      "now or in the future require sponsorship",
      "require sponsorship now or in the future",
      "will you require sponsorship",
      "would you require sponsorship",
      "do you require sponsorship",
      "require future sponsorship",
      "future sponsorship",
      "need sponsorship",
      "require sponsorship",
      "visa sponsorship",
      "employment visa sponsorship",
      "sponsorship for employment",
      "sponsorship",
      "h 1b sponsorship",
      "h1b sponsorship",
    ],
  },
  {
    id: "requireSponsorship",
    phrases: [
      "do you require visa sponsorship",
      "do you require sponsorship",
      "will you require visa sponsorship",
      "will you require sponsorship",
      "require visa sponsorship",
      "require sponsorship",
    ],
  },
  {
    id: "futureSponsorship",
    phrases: [
      "in the future require sponsorship",
      "future require sponsorship",
      "future sponsorship",
      "require sponsorship in the future",
      "will require sponsorship in the future",
    ],
  },
  {
    id: "locationRequirement",
    phrases: [
      "does this work for you",
      "are you able to work from",
      "able to work from",
      "willing to commute",
      "comfortable commuting",
      "hybrid attendance",
      "in office requirement",
      "in office",
      "on site",
      "onsite",
      "hybrid",
      "remote in",
      "remote work",
    ],
  },
  {
    id: "relocation",
    phrases: [
      "willing to relocate",
      "able to relocate",
      "open to relocate",
      "open to relocation",
      "relocate for this role",
      "relocate",
      "relocation",
    ],
  },
  {
    id: "stateResidency",
    phrases: [
      "currently a resident and located",
      "resident and located in the state",
      "currently a resident",
      "located in the state",
      "resident of the state",
      "resident in the state",
      "state of residence",
    ],
  },
  {
    id: "ageOver18",
    phrases: [
      "are you at least 18 years old",
      "are you over 18",
      "18 years of age or older",
      "at least eighteen years old",
      "over the age of 18",
      "age of 18",
    ],
  },
  {
    id: "previouslyApplied",
    phrases: [
      "previously applied",
      "applied to this company before",
      "applied for a role here before",
      "applied here before",
      "have you applied before",
      "have you previously applied",
    ],
  },
  {
    id: "previouslyEmployed",
    phrases: [
      "previously employed",
      "worked at this company before",
      "worked here before",
      "former employee",
      "have you worked here before",
      "have you previously worked",
    ],
  },
  {
    id: "referralName",
    phrases: [
      "employee referral name",
      "referral name",
      "who referred you",
      "were you referred",
      "referred by",
      "name of referrer",
      "referrer",
      "referral",
    ],
    keywords: ["referral", "referrer", "referred"],
  },
  {
    id: "source",
    phrases: [
      "how did you hear about this job",
      "how did you hear about us",
      "how did you find this job",
      "how did you learn about this opportunity",
      "source of application",
      "application source",
      "job source",
      "source",
    ],
    keywords: ["source"],
  },

  // ── EEO / voluntary self-identification ─────────────────────────────
  {
    id: "hispanicLatino",
    phrases: [
      "hispanic or latino",
      "hispanic latino",
      "hispanic/latino",
      "hispanic",
      "latino",
      "latinx",
      "latine",
    ],
  },
  {
    id: "race",
    phrases: [
      "race ethnicity",
      "race / ethnicity",
      "race or ethnicity",
      "race/ethnicity",
      "ethnicity",
      "please identify your race",
      "race",
    ],
  },
  {
    id: "gender",
    phrases: [
      "gender identity",
      "gender",
      "sex assigned",
      "sex",
    ],
  },
  {
    id: "pronouns",
    phrases: [
      "preferred pronouns",
      "your pronouns",
      "pronouns",
    ],
    keywords: ["pronouns"],
  },
  {
    id: "veteranStatus",
    phrases: [
      "protected veteran status",
      "protected veteran",
      "veteran status",
      "veteran",
    ],
  },
  {
    id: "disabilityStatus",
    phrases: [
      "voluntary self identification of disability",
      "self identification of disability",
      "disability status",
      "disability",
    ],
  },

  // ── Standard profile fields ─────────────────────────────────────────
  {
    id: "email",
    autocomplete: ["email"],
    inputTypes: ["email"],
    phrases: ["email address", "e mail address", "e-mail address", "e mail", "e-mail", "email"],
    keywords: ["email", "e mail"],
  },
  {
    id: "phone",
    autocomplete: ["tel", "tel-national", "tel-local"],
    inputTypes: ["tel"],
    phrases: ["phone number", "mobile number", "telephone number", "phone", "telephone", "mobile"],
    keywords: ["phone", "mobile", "telephone"],
  },
  {
    id: "fullName",
    autocomplete: ["name"],
    phrases: ["legal name", "full legal name", "full name", "your name", "name"],
    keywords: ["full name", "legal name", "name"],
  },
  {
    id: "firstName",
    autocomplete: ["given-name"],
    phrases: ["first name", "given name", "preferred first name"],
    keywords: ["first name", "given name", "firstname", "fname"],
  },
  {
    id: "lastName",
    autocomplete: ["family-name"],
    phrases: ["last name", "family name", "surname"],
    keywords: ["last name", "family name", "lastname", "lname", "surname"],
  },
  {
    id: "addressLine1",
    autocomplete: ["address-line1"],
    phrases: ["address line 1", "address line one", "street address line 1", "street address"],
    keywords: ["address line 1", "address1", "street address"],
  },
  {
    id: "addressLine2",
    autocomplete: ["address-line2"],
    phrases: ["address line 2", "address line two", "apartment", "suite", "unit"],
    keywords: ["address line 2", "address2", "apartment", "suite", "unit"],
  },
  {
    id: "address",
    autocomplete: ["street-address"],
    phrases: ["mailing address", "home address", "address"],
    keywords: ["address"],
  },
  {
    id: "currentLocation",
    phrases: [
      "where are you currently located",
      "where are you located",
      "where do you currently live",
      "where do you live",
      "current location city and state",
      "current city and state",
      "current location",
      "your current location",
      "city and state",
      "your location",
      "location",
    ],
  },
  {
    id: "city",
    autocomplete: ["address-level2"],
    phrases: ["city", "town"],
    keywords: ["city", "town"],
  },
  {
    id: "state",
    autocomplete: ["address-level1"],
    phrases: ["state / province", "state or province", "state province", "state/province", "province", "state"],
    keywords: ["state", "province", "region"],
  },
  {
    id: "zip",
    autocomplete: ["postal-code"],
    phrases: ["zip code", "postal code", "zip / postal code", "zip postal code", "postcode", "zip"],
    keywords: ["zip", "postal", "postcode"],
  },
  {
    id: "country",
    autocomplete: ["country", "country-name"],
    phrases: ["country of residence", "country/region", "country region", "country"],
    keywords: ["country"],
  },
];

// These are warnings in Phase 3.1, not blockers. sidepanel.js can still fill
// them when the user chooses Fill all available fields.
export const ALWAYS_REVIEW = new Set([
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
  "gender",
  "race",
  "hispanicLatino",
  "veteranStatus",
  "disabilityStatus",
]);

export const SENSITIVE = new Set([
  "gender",
  "race",
  "hispanicLatino",
  "veteranStatus",
  "disabilityStatus",
]);