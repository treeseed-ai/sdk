import { writeFileSync } from 'node:fs';

type ZipEntry = { path: string; bytes: Uint8Array };

const encoder = new TextEncoder();
const crcTable = Array.from({ length: 256 }, (_unused, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	return value >>> 0;
});

function crc32(bytes: Uint8Array) {
	let value = 0xffffffff;
	for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
	return (value ^ 0xffffffff) >>> 0;
}

function uint16(value: number) {
	const bytes = new Uint8Array(2);
	new DataView(bytes.buffer).setUint16(0, value, true);
	return bytes;
}

function uint32(value: number) {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, true);
	return bytes;
}

function join(parts: Uint8Array[]) {
	const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
	let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.length; }
	return result;
}

function safePath(path: string) {
	const normalized = path.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '');
	if (!normalized || normalized.split('/').includes('..')) throw new Error(`Unsafe knowledge-pack path: ${path}`);
	return normalized;
}

export function createDeterministicZip(entries: ZipEntry[]) {
	const local: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
		const name = encoder.encode(safePath(entry.path));
		const checksum = crc32(entry.bytes);
		const localHeader = join([
			uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
			uint32(checksum), uint32(entry.bytes.length), uint32(entry.bytes.length), uint16(name.length), uint16(0), name,
		]);
		local.push(localHeader, entry.bytes);
		central.push(join([
			uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
			uint32(checksum), uint32(entry.bytes.length), uint32(entry.bytes.length), uint16(name.length), uint16(0),
			uint16(0), uint16(0), uint16(0), uint32(0), uint32(offset), name,
		]));
		offset += localHeader.length + entry.bytes.length;
	}
	const centralBytes = join(central);
	return join([...local, centralBytes, uint32(0x06054b50), uint16(0), uint16(0), uint16(entries.length),
		uint16(entries.length), uint32(centralBytes.length), uint32(offset), uint16(0)]);
}

export function writeDeterministicZip(path: string, entries: ZipEntry[]) {
	writeFileSync(path, createDeterministicZip(entries));
}
