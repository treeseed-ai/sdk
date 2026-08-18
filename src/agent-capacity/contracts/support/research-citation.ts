export type ResearchCitationConfidence = 'low' | 'medium' | 'high';

/** Portable claim-to-source evidence used by research-capable content models. */
export interface ResearchCitation {
	sourceUrl: string;
	title: string;
	author?: string;
	publisher?: string;
	publishedAt?: string;
	retrievedAt: string;
	contentHash: string;
	excerpt?: string;
	license?: string;
	claimIds: string[];
	confidence: ResearchCitationConfidence;
}
