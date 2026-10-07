package vn.editor.processing.jobs.application.query;

import java.time.Instant;
import vn.editor.common.storage.StorageProvider.ObjectRef;

public record JobDetails(JobView view, ObjectRef outputRef, long bytes, Instant expiresAt) {}
