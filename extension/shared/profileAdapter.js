// Converts the desktop ApplicationProfile into the single flat profile shape
// consumed by fieldMatcher/fieldCategories and the autofill planner.
export function normalizeDesktopProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  const value = (key) => source[key] == null ? "" : String(source[key]).trim();

  return {
    firstName: value("firstName"),
    lastName: value("lastName"),
    fullName: value("name") || [value("firstName"), value("lastName")].filter(Boolean).join(" "),
    email: value("email"),
    phone: value("phone"),
    country: value("country"),
    address: value("address"),
    addressLine1: value("address"),
    addressLine2: "",
    city: value("city"),
    state: value("state"),
    stateCode: value("state"),
    zip: value("zip"),
    postalCode: value("zip"),
    currentLocation: [value("city"), value("state")].filter(Boolean).join(", "),
    linkedinUrl: value("linkedin"),
    githubUrl: value("github"),
    portfolioUrl: value("portfolio"),
    personalWebsite: value("portfolio"),
    otherWebsite: value("portfolio"),
    workAuthorization: value("workAuthorization").toLowerCase(),
    sponsorship: value("sponsorship").toLowerCase(),
    requireSponsorship: value("sponsorship").toLowerCase(),
    futureSponsorship: value("sponsorship").toLowerCase(),
    educationEndDate: value("graduationDate"),
    expectedGraduationDate: value("graduationDate"),
    graduationDate: value("graduationDate"),
    educationSchoolName: value("school"),
    schoolName: value("school"),
    universityName: value("school"),
  };
}
