const clean = (value) => typeof value === "string" ? value.trim() : "";

export function applicationProfileToIdentity(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("A default JobTrack Application Profile is required.");
  }
  const name = [clean(profile.firstName), clean(profile.lastName)].filter(Boolean).join(" ");
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
