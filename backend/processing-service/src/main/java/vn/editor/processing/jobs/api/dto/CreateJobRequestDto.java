package vn.editor.processing.jobs.api.dto;

public record CreateJobRequestDto(String documentId, long revision, String type) {}
