export type CapacityFailureDisposition = 'retryable' | 'terminal' | 'operator-action';

export interface CapacityFailureClassification {
	schemaVersion: 1;
	code: string;
	disposition: CapacityFailureDisposition;
	reason: string;
	retryable: boolean;
	requiresOperatorAction: boolean;
}
