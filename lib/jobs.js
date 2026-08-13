const { randomUUID } = require('crypto');

/** @type {Map<string, {status:string, progress:number, eta:string, filePath?:string, tmpDir?:string, title?:string, error?:string, listeners:Set<Function>}>} */
const jobs = new Map();

function createJob() {
  const id = randomUUID();
  jobs.set(id, { status: 'starting', progress: 0, eta: '', listeners: new Set() });
  return id;
}

function getJob(id) {
  return jobs.get(id);
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  job.listeners.forEach((fn) => fn(job));
}

function removeJob(id) {
  jobs.delete(id);
}

module.exports = { createJob, getJob, updateJob, removeJob };
