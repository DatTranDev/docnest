package vn.editor.processing.bootstrap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import vn.editor.processing.jobs.application.command.CancelExportJobCommandHandler;
import vn.editor.processing.jobs.application.command.CreateExportJobCommandHandler;
import vn.editor.processing.jobs.application.port.DocumentAccessPort;
import vn.editor.processing.jobs.application.port.JobCommandRepository;
import vn.editor.processing.jobs.application.port.JobReadRepository;
import vn.editor.processing.jobs.application.port.ResultStoragePort;
import vn.editor.processing.jobs.application.query.GetJobDownloadQueryHandler;
import vn.editor.processing.jobs.application.query.GetJobQueryHandler;
import vn.editor.processing.jobs.application.query.ListJobsQueryHandler;

@Configuration
public class JobUseCases {
  @Bean
  CreateExportJobCommandHandler createExportJob(
      JobCommandRepository commands, DocumentAccessPort documents) {
    return new CreateExportJobCommandHandler(commands, documents);
  }

  @Bean
  CancelExportJobCommandHandler cancelExportJob(
      JobCommandRepository commands, JobReadRepository reads, DocumentAccessPort documents) {
    return new CancelExportJobCommandHandler(commands, reads, documents);
  }

  @Bean
  GetJobQueryHandler getJob(JobReadRepository reads, DocumentAccessPort documents) {
    return new GetJobQueryHandler(reads, documents);
  }

  @Bean
  ListJobsQueryHandler listJobs(JobReadRepository reads, DocumentAccessPort documents) {
    return new ListJobsQueryHandler(reads, documents);
  }

  @Bean
  GetJobDownloadQueryHandler getJobDownload(
      GetJobQueryHandler jobs,
      ResultStoragePort storage,
      @Value("${editor.public-base-url}") String base) {
    return new GetJobDownloadQueryHandler(jobs, storage, base);
  }
}
