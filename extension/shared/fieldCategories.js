// Central field registry. Each category supports rich metadata used by both
// the field matcher (classification + scoring) and the autofill engine
// (value formatting + safety gating).
//
// Category schema:
//   id              — stable internal id (also used as a default profile key)
//   profileKey      — which key on the normalized profile to read from. Defaults to id.
//   phrases         — multi-word phrases that strongly imply this category
//                     when they appear in the visible label/aria/placeholder.
//   keywords        — single tokens to match against id/name (snake/camel).
//   autocomplete    — autocomplete attribute values that imply this category.
//   inputTypes      — input[type=...] values that imply this category.
//   contextClues    — phrases that, when found in the section/parent-block
//                     text, push the score up. Used for vague labels like
//                     "Year" that only make sense inside an Education block.
//   negativeClues   — phrases that, when found anywhere in the field's text,
//                     drop the score. Used to keep e.g. "salary" out of GPA.
//   expectedType    — value type for pre-fill formatting. One of:
//                       text, yesNo, year, monthYear, date, gpa, number,
//                       email, tel, url, select.
//   safety          — high | review | sensitive
//                       review     → never silently autofill, mark for review
//                       sensitive  → review + EEO/voluntary marker
//                       high       → ok to autofill at high confidence
//
// Backwards-compat exports: ALWAYS_REVIEW and SENSITIVE sets are derived from
// the safety field so older code paths keep working.

export const CATEGORIES = [
  // ── Online profile / links ──────────────────────────────────────────
  {
    id: "linkedinUrl",
    expectedType: "url",
    safety: "high",
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
    expectedType: "url",
    safety: "high",
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
    expectedType: "url",
    safety: "high",
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
    expectedType: "url",
    safety: "high",
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
    expectedType: "url",
    safety: "high",
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

  // ── Education ───────────────────────────────────────────────────────
  // Year/date-only sub-categories live above the broader date categories so
  // a "Start year" label inside an Education section resolves to the year
  // category, not the start-date one.
  {
    id: "educationStartYear",
    profileKey: "educationStartDate",
    expectedType: "year",
    safety: "review",
    phrases: [
      "school start year",
      "education start year",
      "degree start year",
      "program start year",
      "start year",
    ],
    keywords: ["start year", "from year"],
    contextClues: ["education", "school", "university", "college", "degree"],
    negativeClues: ["work", "experience", "employment", "job"],
  },
  {
    id: "educationEndYear",
    profileKey: "educationEndDate",
    expectedType: "year",
    safety: "review",
    phrases: [
      "school end year",
      "education end year",
      "degree end year",
      "program end year",
      "graduation year",
      "end year",
    ],
    keywords: ["end year", "to year", "graduation year"],
    contextClues: ["education", "school", "university", "college", "degree"],
    negativeClues: ["work", "experience", "employment", "job"],
  },
  {
    id: "educationStartDate",
    expectedType: "monthYear",
    safety: "review",
    phrases: [
      "education school start date",
      "school start date",
      "education start date",
      "degree start date",
      "program start date",
      "start date for your current degree",
      "start date for current degree program",
    ],
    keywords: ["start date"],
    contextClues: ["education", "school", "university", "college", "degree"],
    negativeClues: ["work", "experience", "employment", "earliest"],
  },
  {
    id: "educationEndDate",
    expectedType: "monthYear",
    safety: "review",
    phrases: [
      "education school end date",
      "school end date",
      "education end date",
      "degree end date",
      "program end date",
      "graduation date",
      "expected graduation date",
      "expected graduation date month and year",
      "what is your expected graduation date",
      "current degree program",
    ],
    keywords: ["end date", "graduation date"],
    contextClues: ["education", "school", "university", "college", "degree"],
    negativeClues: ["work", "experience", "employment"],
  },
  {
    id: "expectedGraduationDate",
    profileKey: "educationEndDate",
    expectedType: "monthYear",
    safety: "review",
    phrases: [
      "expected graduation date",
      "expected graduation",
      "anticipated graduation",
      "graduation date",
      "graduation month and year",
    ],
    keywords: ["graduation"],
    contextClues: ["education", "school", "university", "college"],
  },
  {
    id: "currentGpa",
    expectedType: "gpa",
    safety: "review",
    phrases: [
      "current cumulative gpa",
      "cumulative gpa",
      "current gpa",
      "gpa on a 4.0 scale",
      "4.0 scale",
      "most recent degree program",
      "gpa",
    ],
    keywords: ["gpa"],
    contextClues: ["education", "school", "academic", "degree"],
    negativeClues: ["salary", "compensation", "wage"],
  },
  {
    id: "educationSchoolName",
    expectedType: "text",
    safety: "review",
    phrases: [
      "school name",
      "education school name",
      "institution name",
      "university name",
      "college name",
      "name of school",
      "name of institution",
      "current school",
      "current university",
      "most recent school",
      "most recent university",
      "school",
      "university",
      "college",
      "institution",
    ],
    keywords: ["school", "university", "college", "institution"],
    contextClues: ["education", "academic", "degree"],
    negativeClues: ["high school", "company", "employer", "work"],
  },

  // ── Experience (placeholders — section-aware so "Title" inside an
  // Experience block does not collide with anything else) ─────────────
  {
    id: "companyName",
    expectedType: "text",
    safety: "review",
    phrases: ["company name", "employer name", "company", "employer"],
    keywords: ["company", "employer"],
    contextClues: ["experience", "employment", "work history", "previous role"],
    negativeClues: ["education", "school", "university"],
  },
  {
    id: "jobTitle",
    expectedType: "text",
    safety: "review",
    phrases: ["job title", "position title", "role title", "your title", "title"],
    keywords: ["job title", "position", "role"],
    contextClues: ["experience", "employment", "work history", "previous role"],
    negativeClues: ["education", "school", "university", "degree"],
  },

  // ── Work eligibility / application questions ────────────────────────
  {
    id: "earliestStartDate",
    expectedType: "date",
    safety: "review",
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
    keywords: ["start date", "availability"],
    negativeClues: ["education", "school", "university", "degree", "graduation"],
  },
  {
    id: "workAuthorization",
    expectedType: "yesNo",
    safety: "review",
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
    keywords: ["authorization", "authorized"],
  },
  {
    id: "sponsorship",
    expectedType: "yesNo",
    safety: "review",
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
    keywords: ["sponsorship", "visa"],
  },
  {
    id: "requireSponsorship",
    expectedType: "yesNo",
    safety: "review",
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
    expectedType: "yesNo",
    safety: "review",
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
    expectedType: "yesNo",
    safety: "review",
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
    expectedType: "yesNo",
    safety: "review",
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
    expectedType: "yesNo",
    safety: "review",
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
    expectedType: "yesNo",
    safety: "review",
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
    expectedType: "yesNo",
    safety: "review",
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
    expectedType: "yesNo",
    safety: "review",
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
    expectedType: "text",
    safety: "high",
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
    expectedType: "text",
    safety: "high",
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

  // ── EEO / voluntary self-identification (sensitive) ─────────────────
  {
    id: "hispanicLatino",
    expectedType: "yesNo",
    safety: "sensitive",
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
    expectedType: "select",
    safety: "sensitive",
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
    expectedType: "select",
    safety: "sensitive",
    phrases: [
      "gender identity",
      "gender",
      "sex assigned",
      "sex",
    ],
  },
  {
    id: "pronouns",
    expectedType: "text",
    safety: "review",
    phrases: [
      "preferred pronouns",
      "your pronouns",
      "pronouns",
    ],
    keywords: ["pronouns"],
  },
  {
    id: "veteranStatus",
    expectedType: "select",
    safety: "sensitive",
    phrases: [
      "protected veteran status",
      "protected veteran",
      "veteran status",
      "veteran",
    ],
  },
  {
    id: "disabilityStatus",
    expectedType: "select",
    safety: "sensitive",
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
    expectedType: "email",
    safety: "high",
    autocomplete: ["email"],
    inputTypes: ["email"],
    phrases: ["email address", "e mail address", "e-mail address", "e mail", "e-mail", "email"],
    keywords: ["email", "e mail"],
  },
  {
    id: "phone",
    expectedType: "tel",
    safety: "high",
    autocomplete: ["tel", "tel-national", "tel-local"],
    inputTypes: ["tel"],
    phrases: ["phone number", "mobile number", "telephone number", "phone", "telephone", "mobile"],
    keywords: ["phone", "mobile", "telephone"],
  },
  {
    id: "fullName",
    expectedType: "text",
    safety: "high",
    autocomplete: ["name"],
    phrases: ["legal name", "full legal name", "full name", "your name", "name"],
    keywords: ["full name", "legal name", "name"],
  },
  {
    id: "firstName",
    expectedType: "text",
    safety: "high",
    autocomplete: ["given-name"],
    phrases: ["first name", "given name", "preferred first name"],
    keywords: ["first name", "given name", "firstname", "fname"],
  },
  {
    id: "lastName",
    expectedType: "text",
    safety: "high",
    autocomplete: ["family-name"],
    phrases: ["last name", "family name", "surname"],
    keywords: ["last name", "family name", "lastname", "lname", "surname"],
  },
  {
    id: "addressLine1",
    expectedType: "text",
    safety: "high",
    autocomplete: ["address-line1"],
    phrases: ["address line 1", "address line one", "street address line 1", "street address"],
    keywords: ["address line 1", "address1", "street address"],
  },
  {
    id: "addressLine2",
    expectedType: "text",
    safety: "high",
    autocomplete: ["address-line2"],
    phrases: ["address line 2", "address line two", "apartment", "suite", "unit"],
    keywords: ["address line 2", "address2", "apartment", "suite", "unit"],
  },
  {
    id: "address",
    expectedType: "text",
    safety: "high",
    autocomplete: ["street-address"],
    phrases: ["mailing address", "home address", "address"],
    keywords: ["address"],
  },
  {
    id: "currentLocation",
    expectedType: "text",
    safety: "high",
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
    expectedType: "text",
    safety: "high",
    autocomplete: ["address-level2"],
    phrases: ["city", "town"],
    keywords: ["city", "town"],
  },
  {
    id: "state",
    expectedType: "text",
    safety: "high",
    autocomplete: ["address-level1"],
    phrases: ["state / province", "state or province", "state province", "state/province", "province", "state"],
    keywords: ["state", "province", "region"],
  },
  {
    id: "zip",
    expectedType: "text",
    safety: "high",
    autocomplete: ["postal-code"],
    phrases: ["zip code", "postal code", "zip / postal code", "zip postal code", "postcode", "zip"],
    keywords: ["zip", "postal", "postcode"],
  },
  {
    id: "country",
    expectedType: "text",
    safety: "high",
    autocomplete: ["country", "country-name"],
    phrases: ["country of residence", "country/region", "country region", "country"],
    keywords: ["country"],
  },
];

// Resolve the profile key for a category. Defaults to the category id when
// the registry doesn't override it.
export function profileKeyFor(categoryId) {
  if (!categoryId) return "";
  const entry = CATEGORIES.find((c) => c.id === categoryId);
  return entry?.profileKey || categoryId;
}

export function expectedTypeFor(categoryId) {
  if (!categoryId) return "text";
  const entry = CATEGORIES.find((c) => c.id === categoryId);
  return entry?.expectedType || "text";
}

export function safetyFor(categoryId) {
  if (!categoryId) return "high";
  const entry = CATEGORIES.find((c) => c.id === categoryId);
  return entry?.safety || "high";
}

// Backwards-compat sets derived from the safety field. Existing callers can
// keep importing ALWAYS_REVIEW / SENSITIVE without churn.
export const ALWAYS_REVIEW = new Set(
  CATEGORIES.filter((c) => c.safety === "review" || c.safety === "sensitive").map((c) => c.id)
);

export const SENSITIVE = new Set(
  CATEGORIES.filter((c) => c.safety === "sensitive").map((c) => c.id)
);

// Categories whose planned value should be treated as yes/no — derived from
// expectedType so adding a new yes/no question only requires one place.
export const YES_NO_CATEGORIES = new Set(
  CATEGORIES.filter((c) => c.expectedType === "yesNo").map((c) => c.id)
);
