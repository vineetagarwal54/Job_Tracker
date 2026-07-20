import { useCallback, useEffect, useRef, useState } from "react";
import { messageForResumeError, missingGenerationRequirements, subscribeToGeneration } from "../utils/resumeGeneration";

const ESTIMATES = { resume: 0.04, "resume-and-cover-letter": 0.05 };

const normalizeJob = (job) => ({
  company: String(job?.company || "Untitled"),
  title: String(job?.title || job?.role || "Role"),
  description: String(job?.description || job?.jd || ""),
});

export function useDocumentGeneration({ status, onResumeComplete, onCoverLetterComplete } = {}) {
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState("choice");
  const [progress, setProgress] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const [coverLetterError, setCoverLetterError] = useState("");
  const [resumeResult, setResumeResult] = useState(null);
  const [coverLetterResult, setCoverLetterResult] = useState(null);
  const [estimatedCostUsd, setEstimatedCostUsd] = useState(0);
  const activeRef = useRef(false);
  const timerRef = useRef(null);
  const listenerRef = useRef(() => {});

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    listenerRef.current();
    listenerRef.current = () => {};
  }, []);

  const reset = useCallback(() => {
    cleanup();
    activeRef.current = false;
    setActive(false); setMode("choice"); setProgress(""); setElapsedSeconds(0);
    setError(""); setCoverLetterError(""); setResumeResult(null); setCoverLetterResult(null); setEstimatedCostUsd(0);
  }, [cleanup]);

  useEffect(() => () => {
    cleanup();
    if (activeRef.current) window.resume?.cancelGeneration?.();
  }, [cleanup]);

  const generate = useCallback(async ({ job, documentChoice }) => {
    if (activeRef.current) {
      setError(messageForResumeError({ code: "GENERATION_ACTIVE" }));
      return null;
    }
    const normalizedJob = normalizeJob(job);
    const requirements = missingGenerationRequirements({ status, job: normalizedJob, active: false });
    if (requirements.length) {
      setError(`Required: ${requirements.join(", ")}.`);
      return null;
    }
    activeRef.current = true;
    setActive(true); setMode("generating"); setError(""); setCoverLetterError("");
    setResumeResult(null); setCoverLetterResult(null); setElapsedSeconds(0);
    setEstimatedCostUsd(ESTIMATES[documentChoice] || ESTIMATES.resume);
    setProgress("Analyzing job requirements");
    cleanup();
    listenerRef.current = subscribeToGeneration(window.resume, (event) => {
      if (event?.type === "started" || event?.type === "progress") setProgress(event.message || "Generating documents");
      if (event?.type === "cancelled") setProgress("Generation cancelled");
    });
    timerRef.current = setInterval(() => setElapsedSeconds(seconds => seconds + 1), 1000);
    try {
      const response = await window.resume.generate(normalizedJob);
      if (!response?.ok) {
        if (response?.error?.code === "CANCELLED") {
          setMode("choice"); setProgress(""); setElapsedSeconds(0); setEstimatedCostUsd(0);
        } else setError(messageForResumeError(response?.error));
        return null;
      }
      const resume = response.result;
      setResumeResult(resume); setEstimatedCostUsd(Number(resume.estimatedCostUsd || 0)); setProgress("Resume completed");
      onResumeComplete?.(resume, normalizedJob);
      if (documentChoice !== "resume-and-cover-letter") return { resumeResult: resume, coverLetterResult: null };

      setProgress("Drafting cover letter");
      const coverResponse = await window.resume.generateCoverLetter({ job: normalizedJob, analysis: resume.analysis, selection: resume.selection });
      if (!coverResponse?.ok) {
        if (coverResponse?.error?.code === "CANCELLED") setProgress("Resume completed");
        else setCoverLetterError(messageForResumeError(coverResponse?.error));
        return { resumeResult: resume, coverLetterResult: null };
      }
      const coverLetter = coverResponse.result;
      setCoverLetterResult(coverLetter);
      setEstimatedCostUsd(Number(resume.estimatedCostUsd || 0) + Number(coverLetter.estimatedCostUsd || 0));
      setProgress("Completed");
      onCoverLetterComplete?.(coverLetter, normalizedJob);
      return { resumeResult: resume, coverLetterResult: coverLetter };
    } catch {
      setError("JobTrack could not start document generation.");
      return null;
    } finally {
      activeRef.current = false;
      setActive(false);
      cleanup();
    }
  }, [cleanup, onCoverLetterComplete, onResumeComplete, status]);

  // Cover-letter-only (task Part 5): generate a cover letter for a new JD using
  // an existing resume's stored evidence, WITHOUT regenerating the resume. The
  // new JD is analyzed fresh (falling back to the source resume's analysis), and
  // the cover letter draws only on the source selection and verified bank.
  const generateCoverLetterOnly = useCallback(async ({ job, source }) => {
    if (activeRef.current) { setCoverLetterError(messageForResumeError({ code: "GENERATION_ACTIVE" })); return null; }
    if (!source?.selection || !source?.analysis) { setCoverLetterError("Select a generated resume to base the cover letter on."); return null; }
    const normalizedJob = normalizeJob(job);
    const requirements = missingGenerationRequirements({ status, job: normalizedJob, active: false });
    if (requirements.length) { setCoverLetterError(`Required: ${requirements.join(", ")}.`); return null; }
    activeRef.current = true;
    setActive(true); setMode("generating"); setError(""); setCoverLetterError("");
    setCoverLetterResult(null); setElapsedSeconds(0); setEstimatedCostUsd(ESTIMATES.resume);
    setProgress("Analyzing job requirements");
    cleanup();
    listenerRef.current = subscribeToGeneration(window.resume, (event) => {
      if (event?.type === "started" || event?.type === "progress") setProgress(event.message || "Generating cover letter");
      if (event?.type === "cancelled") setProgress("Generation cancelled");
    });
    timerRef.current = setInterval(() => setElapsedSeconds(seconds => seconds + 1), 1000);
    try {
      let analysis = source.analysis;
      try { const analyzed = await window.resume.analyzeJob(normalizedJob); if (analyzed?.ok && analyzed.analysis) analysis = analyzed.analysis; } catch { /* keep source analysis */ }
      const response = await window.resume.generateCoverLetter({ job: normalizedJob, analysis, selection: source.selection });
      if (!response?.ok) {
        if (response?.error?.code === "CANCELLED") { setMode("choice"); setProgress(""); }
        else setCoverLetterError(messageForResumeError(response?.error));
        return null;
      }
      const coverLetter = response.result;
      setCoverLetterResult(coverLetter);
      setEstimatedCostUsd(Number(coverLetter.estimatedCostUsd || 0));
      setProgress("Completed");
      onCoverLetterComplete?.(coverLetter, normalizedJob);
      return coverLetter;
    } catch {
      setCoverLetterError("JobTrack could not generate the cover letter.");
      return null;
    } finally {
      activeRef.current = false;
      setActive(false);
      cleanup();
    }
  }, [cleanup, onCoverLetterComplete, status]);

  const cancel = useCallback(async () => {
    if (!activeRef.current) return;
    setProgress("Cancelling generation");
    await window.resume?.cancelGeneration?.();
  }, []);

  return { active, mode, progress, elapsedSeconds, error, coverLetterError, resumeResult, coverLetterResult, estimatedCostUsd, generate, generateCoverLetterOnly, cancel, reset };
}
