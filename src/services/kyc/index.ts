export {
  createApplication,
  getApplications,
  getApplication,
  attachDocuments,
  processMachineReview,
  submitValidation,
  registerValidator,
  getValidatorTasks,
  getValidatorMe,
  getRedactedTasks,
  ensureValidator,
} from "./kycService";

export type { RedactedTask } from "./kycService";
