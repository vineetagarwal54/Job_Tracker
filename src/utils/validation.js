// Validates the job form. Returns { isValid, errors } where errors
// maps field names to human-readable messages. Empty errors ⇒ form is valid.
export function validateJobForm(form) {
  const errors = {};
  if (!form.company || !form.company.trim()) errors.company = "Company is required.";
  if (!form.role || !form.role.trim()) errors.role = "Role is required.";
  return { isValid: Object.keys(errors).length === 0, errors };
}

// Validates an application profile. Required: name (label), firstName,
// lastName, email. Email gets a basic shape check.
export function validateProfileForm(form) {
  const errors = {};
  if (!form.name || !form.name.trim()) errors.name = "Profile name is required.";
  if (!form.firstName || !form.firstName.trim()) errors.firstName = "First name is required.";
  if (!form.lastName || !form.lastName.trim()) errors.lastName = "Last name is required.";
  if (!form.email || !form.email.trim()) {
    errors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  return { isValid: Object.keys(errors).length === 0, errors };
}
