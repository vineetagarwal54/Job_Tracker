// Validates the job form. Returns { isValid, errors } where errors
// maps field names to human-readable messages. Empty errors ⇒ form is valid.
export function validateJobForm(form) {
  const errors = {};
  if (!form.company || !form.company.trim()) errors.company = "Company is required.";
  if (!form.role || !form.role.trim()) errors.role = "Role is required.";
  return { isValid: Object.keys(errors).length === 0, errors };
}
