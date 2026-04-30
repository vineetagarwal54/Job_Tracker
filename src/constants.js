export const RESUME_VERSIONS = ["Mobile", "AI/ML", "General/Full-stack", "Frontend", "Academic", "Custom"];
export const WORK_TYPES = ["Remote", "Hybrid", "Onsite"];
export const SOURCES = ["LinkedIn", "Indeed", "Company Site", "Referral", "Handshake", "Other"];
export const PRIORITIES = ["High", "Medium", "Low"];

export const STATUS_CONFIG = {
  "Wishlist":    { color: "#94a3b8", bg: "#1e293b", dot: "#94a3b8" },
  "Applied":     { color: "#60a5fa", bg: "#1e3a5f", dot: "#60a5fa" },
  "OA Pending":   { color: "#fb923c", bg: "#3d2508", dot: "#fb923c" },
  "OA Completed": { color: "#fbbf24", bg: "#3d2e0a", dot: "#fbbf24" },
  "Interview":   { color: "#c084fc", bg: "#2e1a47", dot: "#c084fc" },
  "Offer":       { color: "#4ade80", bg: "#0f2e1a", dot: "#4ade80" },
  "Rejected":    { color: "#f87171", bg: "#2d1010", dot: "#f87171" },
  "Withdrawn":   { color: "#9ca3af", bg: "#1a1a1a", dot: "#9ca3af" },
};

export const PRIORITY_CONFIG = {
  "High":   { color: "#f87171", bg: "#2d1010" },
  "Medium": { color: "#fbbf24", bg: "#3d2e0a" },
  "Low":    { color: "#94a3b8", bg: "#1e293b" },
};

export const STATUSES = Object.keys(STATUS_CONFIG);

export const getEmptyForm = () => ({
  company: "", role: "", date: new Date().toISOString().split("T")[0], deadline: "",
  resume: "General/Full-stack", status: "Applied",
  link: "", notes: "", jd: "",
  salary: "", location: "", workType: "Remote",
  source: "LinkedIn", priority: "Medium",
  recruiter: "", recruiterEmail: "",
  workspaceId: null,
});

// Application Profiles — local-only autofill profiles. Kept as a flat object so
// the future Chrome extension can read the same shape without transformation.
export const WORK_AUTH_OPTIONS = ["", "Yes", "No"];
export const SPONSORSHIP_OPTIONS = ["", "Yes", "No"];

export const getEmptyProfile = () => ({
  name: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  country: "",
  linkedin: "",
  github: "",
  portfolio: "",
  school: "",
  degree: "",
  major: "",
  graduationDate: "",
  workAuthorization: "",
  sponsorship: "",
  shortAnswerNotes: "",
  isDefault: false,
});

export const sampleJobs = [
  {
    id: 1, company: "Acme Corp", role: "Mobile App Developer Intern",
    date: "2026-03-01", deadline: "", resume: "Mobile", status: "Interview",
    link: "", notes: "Example entry — click Edit to modify or Del to remove.",
    jd: "Build cross-platform mobile apps using React Native. Work on IoT integrations for smart home devices.",
    salary: "$40/hr", location: "Boston, MA", workType: "Hybrid",
    source: "LinkedIn", priority: "High", recruiter: "Alex Recruiter", recruiterEmail: "recruiter@example.com",
  },
  {
    id: 2, company: "Globex Inc", role: "Software Engineer Intern",
    date: "2026-03-05", deadline: "2026-04-01", resume: "General/Full-stack", status: "OA Pending",
    link: "", notes: "Example entry — this is sample data to help you get started.",
    jd: "Work on backend services and internal tooling. Java / TypeScript stack.",
    salary: "$35/hr", location: "Remote", workType: "Remote",
    source: "Handshake", priority: "Medium", recruiter: "", recruiterEmail: "",
  },
];
