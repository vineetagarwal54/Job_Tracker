const clean = (value) => typeof value === "string" ? value.trim() : "";

export function applicationProfileToIdentity(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("A default JobTrack Application Profile is required.");
  }
  const name = clean(profile.fullName) || [clean(profile.firstName), clean(profile.lastName)].filter(Boolean).join(" ");
  const email = clean(profile.email);
  if (!name) throw new Error("The default Application Profile is missing a first or last name.");
  if (!email) throw new Error("The default Application Profile is missing an email address.");
  const locality = [clean(profile.city), clean(profile.state)].filter(Boolean).join(", ");
  return {
    name,
    location: locality || clean(profile.country),
    phone: clean(profile.phone),
    email,
    links: {
      linkedin: clean(profile.linkedin),
      github: clean(profile.github),
      portfolio: clean(profile.portfolio),
    },
  };
}

export function validateRendererIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error("Runtime resume identity is required.");
  if (!clean(identity.name)) throw new Error("Runtime resume identity is missing name.");
  if (!clean(identity.email)) throw new Error("Runtime resume identity is missing email.");
  return applicationProfileToIdentity({
    firstName: clean(identity.name), lastName: "", email: identity.email,
    city: identity.location, phone: identity.phone,
    linkedin: identity.links?.linkedin, github: identity.links?.github, portfolio: identity.links?.portfolio,
  });
}

export function bankIdentityToIdentity(bank) {
  return validateRendererIdentity(bank?.identity);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /^https?:\/\/\S+$/i;

// Validates the FINAL rendered identity (task Part 4). Name, a complete
// ten-digit US phone, and a well-formed email are required; a malformed value
// throws a specific IDENTITY_INVALID error. Profile links are validated for
// URL format when present and reported as warnings when missing, so a resume is
// never blocked purely for an absent LinkedIn/GitHub/portfolio link.
export function validateFinalIdentity(identity) {
  const errors = [];
  const warnings = [];
  if (!identity || typeof identity !== "object") {
    const error = new Error("Runtime resume identity is missing.");
    error.code = "IDENTITY_INVALID";
    throw error;
  }
  if (!clean(identity.name)) errors.push("candidate name is missing");
  const email = clean(identity.email);
  if (!email) errors.push("email is missing");
  else if (!EMAIL_RE.test(email)) errors.push(`email '${email}' is malformed`);
  const phoneDigits = clean(identity.phone).replace(/\D/g, "");
  if (!phoneDigits) errors.push("phone number is missing");
  else if (phoneDigits.length !== 10) errors.push(`phone number must contain ten digits (found ${phoneDigits.length})`);
  const links = identity.links || {};
  for (const key of ["linkedin", "github", "portfolio"]) {
    const value = clean(links[key]);
    if (!value) warnings.push(`${key} link is not set`);
    else if (!URL_RE.test(value)) errors.push(`${key} link '${value}' is not a valid URL`);
  }
  if (errors.length) {
    const error = new Error(`Resume identity is invalid: ${errors.join("; ")}.`);
    error.code = "IDENTITY_INVALID";
    error.identityErrors = errors;
    throw error;
  }
  return { valid: true, warnings };
}

export function resolveResumeIdentity({ profile, bank }) {
  let fallback;
  try { fallback = bankIdentityToIdentity(bank); } catch { fallback = null; }
  if (!profile || typeof profile !== "object") {
    if (fallback) return fallback;
    const error = new Error("No valid resume identity is available in the Application Profile or content bank."); error.code = "MISSING_PROFILE"; throw error;
  }
  // Profiles override only valid, present fields.  This prevents one malformed
  // value (especially a truncated phone) from replacing verified bank data.
  const candidate = {
    name: clean(profile.fullName) || [clean(profile.firstName), clean(profile.lastName)].filter(Boolean).join(" ") || fallback?.name,
    location: [clean(profile.city), clean(profile.state)].filter(Boolean).join(", ") || clean(profile.country) || fallback?.location,
    phone: clean(profile.phone) || fallback?.phone,
    email: clean(profile.email) || fallback?.email,
    links: {
      linkedin: clean(profile.linkedin) || fallback?.links?.linkedin,
      github: clean(profile.github) || fallback?.links?.github,
      portfolio: clean(profile.portfolio) || fallback?.links?.portfolio,
    },
  };
  try { validateFinalIdentity(candidate); return candidate; }
  catch (error) {
    // A profile's malformed optional override must not poison the bank identity.
    if (fallback) return fallback;
    throw error;
  }
}
