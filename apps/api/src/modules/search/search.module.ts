import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { OpenSearchClient } from './opensearch.client';
import { SearchController, SearchInternalController } from './search.controller';
import { SearchIndexerService } from './search-indexer.service';
import { SearchService } from './search.service';

/** Search (M2.8–M2.12): OpenSearch index, indexer, query + suggest, analytics. */
@Module({
  imports: [CatalogModule],
  controllers: [SearchController, SearchInternalController],
  providers: [OpenSearchClient, SearchService, SearchIndexerService],
  exports: [OpenSearchClient, SearchIndexerService],
})
export class SearchModule {}
