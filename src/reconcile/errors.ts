export class TreeseedReconcileError extends Error {
	code: string;
	unitId: string | null;

	constructor(code: string, message: string, unitId: string | null = null) {
		super(message);
		this.name = 'TreeseedReconcileError';
		this.code = code;
		this.unitId = unitId;
	}
}

