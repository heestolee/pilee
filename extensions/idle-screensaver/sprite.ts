import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

// ─── Korean → Pokemon ID (1세대 151) ───────────────────────────────────────

export const POKEMON_KO_TO_ID: Record<string, number> = {
	"이상해씨": 1, "이상해풀": 2, "이상해꽃": 3,
	"파이리": 4, "리자드": 5, "리자몽": 6,
	"꼬부기": 7, "어니부기": 8, "거북왕": 9,
	"캐터피": 10, "단데기": 11, "버터플": 12,
	"뿔충이": 13, "딱충이": 14, "독침붕": 15,
	"구구": 16, "피죤": 17, "피죤투": 18,
	"꼬렛": 19, "레트라": 20,
	"깨비참": 21, "깨비드릴조": 22,
	"아보": 23, "아보크": 24,
	"피카츄": 25, "라이츄": 26,
	"모래두지": 27, "고지": 28,
	"니드런♀": 29, "니드리나": 30, "니드퀸": 31,
	"니드런♂": 32, "니드리노": 33, "니드킹": 34,
	"삐삐": 35, "픽시": 36,
	"식스테일": 37, "나인테일": 38,
	"푸린": 39, "푸크린": 40,
	"주뱃": 41, "골뱃": 42,
	"뚜벅쵸": 43, "냄새꼬": 44, "라플레시아": 45,
	"파라스": 46, "파라섹트": 47,
	"콘팡": 48, "도나리": 49,
	"디그다": 50, "닥트리오": 51,
	"나옹": 52, "페르시온": 53,
	"고라파덕": 54, "골덕": 55,
	"망키": 56, "성원숭": 57,
	"가디": 58, "윈디": 59,
	"발챙이": 60, "슈륙챙이": 61, "강챙이": 62,
	"캐이시": 63, "윤겔라": 64, "후딘": 65,
	"알통몬": 66, "근육몬": 67, "괴력몬": 68,
	"모다피": 69, "우츠동": 70, "우츠보트": 71,
	"왕눈해": 72, "독파리": 73,
	"꼬마돌": 74, "데구리": 75, "딱구리": 76,
	"포니타": 77, "날쌩마": 78,
	"야돈": 79, "야도란": 80,
	"코일": 81, "레어코일": 82,
	"파오리": 83,
	"두두": 84, "두트리오": 85,
	"쥬쥬": 86, "쥬레곤": 87,
	"질뻐기": 88, "질뻐꾸기": 89,
	"셀러": 90, "파르셀": 91,
	"고오스": 92, "고우스트": 93, "팬텀": 94,
	"롱스톤": 95,
	"슬리프": 96, "슬리퍼": 97,
	"크랩": 98, "킹크랩": 99,
	"찌리리공": 100, "붐볼": 101,
	"아라리": 102, "나시": 103,
	"탕구리": 104, "텅구리": 105,
	"시라소몬": 106, "홍수몬": 107,
	"내루미": 108,
	"또가스": 109, "또도가스": 110,
	"뿔카노": 111, "코뿌리": 112,
	"럭키": 113,
	"덩쿠리": 114,
	"캥카": 115,
	"쏘드라": 116, "시드라": 117,
	"콘치": 118, "왕콘치": 119,
	"별가사리": 120, "아쿠스타": 121,
	"마임맨": 122,
	"스라크": 123,
	"루주라": 124,
	"에레브": 125, "마그마": 126,
	"쁘사이저": 127,
	"켄타로스": 128,
	"잉어킹": 129, "갸라도스": 130,
	"라프라스": 131,
	"메타몽": 132,
	"이브이": 133, "샤미드": 134, "쥬피썬더": 135, "부스터": 136,
	"폴리곤": 137,
	"암나이트": 138, "암스타": 139,
	"투구": 140, "투구푸스": 141,
	"프테라": 142,
	"잠만보": 143,
	"프리져": 144, "썬더": 145, "파이어": 146,
	"미뇽": 147, "신뇽": 148, "망나뇽": 149,
	"뮤츠": 150, "뮤": 151,
};

// ─── Sprite fetch + cache ──────────────────────────────────────────────────

const SPRITE_URL = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
const CACHE_DIR = join(homedir(), ".pi", "agent", "sprite-cache");

export async function getSpritePng(name: string): Promise<Buffer | null> {
	const id = POKEMON_KO_TO_ID[name];
	if (!id) return null;

	const cachePath = join(CACHE_DIR, `${id}.png`);
	if (existsSync(cachePath)) {
		try { return readFileSync(cachePath); } catch {}
	}

	try {
		const response = await fetch(SPRITE_URL(id));
		if (!response.ok) return null;
		const buffer = Buffer.from(await response.arrayBuffer());
		mkdirSync(CACHE_DIR, { recursive: true });
		writeFileSync(cachePath, buffer);
		return buffer;
	} catch {
		return null;
	}
}

// ─── PNG → half-block colored text ─────────────────────────────────────────

interface Pixel {
	r: number;
	g: number;
	b: number;
	a: number;
}

function decodePng(buffer: Buffer): { width: number; height: number; pixels: Pixel[][] } | null {
	try {
		const png = PNG.sync.read(buffer);
		const pixels: Pixel[][] = [];
		for (let y = 0; y < png.height; y++) {
			const row: Pixel[] = [];
			for (let x = 0; x < png.width; x++) {
				const idx = (png.width * y + x) * 4;
				row.push({
					r: png.data[idx],
					g: png.data[idx + 1],
					b: png.data[idx + 2],
					a: png.data[idx + 3],
				});
			}
			pixels.push(row);
		}
		return { width: png.width, height: png.height, pixels };
	} catch {
		return null;
	}
}

function cropToContent(pixels: Pixel[][]): { pixels: Pixel[][]; width: number; height: number } {
	let top = 0, bottom = pixels.length - 1, left = 0, right = pixels[0].length - 1;

	while (top < pixels.length && pixels[top].every((p) => p.a < 16)) top++;
	while (bottom > top && pixels[bottom].every((p) => p.a < 16)) bottom--;
	while (left < pixels[0].length && pixels.every((row) => row[left].a < 16)) left++;
	while (right > left && pixels.every((row) => row[right].a < 16)) right--;

	const cropped = pixels.slice(top, bottom + 1).map((row) => row.slice(left, right + 1));
	return { pixels: cropped, width: cropped[0]?.length ?? 0, height: cropped.length };
}

function downsample(pixels: Pixel[][], maxW: number, maxH: number): Pixel[][] {
	const h = pixels.length;
	const w = pixels[0]?.length ?? 0;
	if (w === 0 || h === 0) return pixels;

	const scale = Math.min(maxW / w, maxH / h, 1);
	const newW = Math.max(1, Math.floor(w * scale));
	const newH = Math.max(1, Math.floor(h * scale));

	const result: Pixel[][] = [];
	for (let y = 0; y < newH; y++) {
		const row: Pixel[] = [];
		const srcY = Math.floor((y / newH) * h);
		for (let x = 0; x < newW; x++) {
			const srcX = Math.floor((x / newW) * w);
			row.push(pixels[srcY][srcX]);
		}
		result.push(row);
	}
	return result;
}

function fg(r: number, g: number, b: number, text: string): string {
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

function fgBg(fr: number, fg_: number, fb: number, br: number, bg_: number, bb: number, text: string): string {
	return `\x1b[38;2;${fr};${fg_};${fb}m\x1b[48;2;${br};${bg_};${bb}m${text}\x1b[0m`;
}

const TRANSPARENT_THRESHOLD = 16;

/**
 * Convert PNG to half-block colored text lines.
 * Each line uses ▀ where:
 * - foreground = top pixel color
 * - background = bottom pixel color
 * Transparent pixels render as space without bg color.
 */
function pngToHalfBlock(pixels: Pixel[][]): string[] {
	const lines: string[] = [];
	const h = pixels.length;
	const w = pixels[0]?.length ?? 0;

	for (let y = 0; y < h; y += 2) {
		let line = "";
		for (let x = 0; x < w; x++) {
			const top = pixels[y][x];
			const bottom = y + 1 < h ? pixels[y + 1][x] : { r: 0, g: 0, b: 0, a: 0 };
			const topT = top.a < TRANSPARENT_THRESHOLD;
			const bottomT = bottom.a < TRANSPARENT_THRESHOLD;

			if (topT && bottomT) {
				line += " ";
			} else if (topT) {
				// only bottom: lower half block
				line += fg(bottom.r, bottom.g, bottom.b, "▄");
			} else if (bottomT) {
				// only top: upper half block
				line += fg(top.r, top.g, top.b, "▀");
			} else {
				// both: upper half with both colors
				line += fgBg(top.r, top.g, top.b, bottom.r, bottom.g, bottom.b, "▀");
			}
		}
		lines.push(line);
	}
	return lines;
}

export async function renderSprite(name: string, maxW = 32, maxH = 32): Promise<string[] | null> {
	const png = await getSpritePng(name);
	if (!png) return null;

	const decoded = decodePng(png);
	if (!decoded) return null;

	const cropped = cropToContent(decoded.pixels);
	const sampled = downsample(cropped.pixels, maxW, maxH);
	return pngToHalfBlock(sampled);
}
