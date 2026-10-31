// The Sri Lankan national curriculum: the subjects, A/L streams and who must choose what.
// A/L numbers are the Department of Examinations' subject numbers (new syllabus list, apps/Docs/AL sublect List.pdf).
// The school decides which of these each class offers; ClassSubject.optionGroup records the outcome.
import type { GradeLevel } from "./types";

export type ChoiceGroup = "first_language" | "religion";

export interface CurriculumSubject {
  code: string;
  name: string;
  levels: GradeLevel[];
  /** O/L: choose one from each of the three baskets. */
  basket?: 1 | 2 | 3;
  /** O/L: compulsory, but each student takes one of the group (Sinhala or Tamil; their religion). */
  choiceGroup?: ChoiceGroup;
  /** The official subject number, e.g. "10" or "25A". */
  examNo?: string;
}

const OL: GradeLevel[] = ["ol"];
const AL: GradeLevel[] = ["al"];
const al = (examNo: string, code: string, name: string): CurriculumSubject => ({ examNo, code, name, levels: AL });
const basket = (n: 1 | 2 | 3, code: string, name: string, levels: GradeLevel[] = OL): CurriculumSubject => ({ code, name, levels, basket: n });

export const CURRICULUM_SUBJECTS: CurriculumSubject[] = [
  // Primary and junior, and the O/L core
  { code: "SIN", name: "Sinhala", levels: ["primary", "junior", "ol"], choiceGroup: "first_language" },
  { code: "TML", name: "Tamil", levels: OL, choiceGroup: "first_language" },
  { code: "ENG", name: "English", levels: ["primary", "junior", "ol"] },
  { code: "MAT", name: "Mathematics", levels: ["primary", "junior", "ol"] },
  { code: "ENV", name: "Environmental Studies", levels: ["primary"] },
  { code: "REL", name: "Religion", levels: ["primary", "junior"] },
  { code: "SCI", name: "Science", levels: ["junior", "ol"] },
  { code: "HIS", name: "History", levels: ["junior", "ol"] },
  { code: "TAM", name: "Tamil (Second Language)", levels: ["junior"] },
  { code: "BUD", name: "Buddhism", levels: OL, choiceGroup: "religion" },
  { code: "HIN", name: "Hinduism (Saivism)", levels: OL, choiceGroup: "religion" },
  { code: "ISL", name: "Islam", levels: OL, choiceGroup: "religion" },
  { code: "CHR", name: "Christianity", levels: OL, choiceGroup: "religion" },
  { code: "CATH", name: "Catholicism", levels: OL, choiceGroup: "religion" },
  // O/L basket I: social sciences, commerce and languages
  basket(1, "BUS", "Business & Accounting Studies"),
  basket(1, "GEO", "Geography", ["junior", "ol"]),
  basket(1, "CIV", "Civic Education", ["junior", "ol"]),
  basket(1, "ENT", "Entrepreneurship Studies"),
  basket(1, "SLSIN", "Second Language (Sinhala)"),
  basket(1, "SLTAM", "Second Language (Tamil)"),
  basket(1, "OLPAL", "Pali"),
  basket(1, "OLSAN", "Sanskrit"),
  basket(1, "OLFRE", "French"),
  basket(1, "OLGER", "German"),
  basket(1, "OLHIN", "Hindi"),
  basket(1, "OLJAP", "Japanese"),
  basket(1, "OLARA", "Arabic"),
  basket(1, "OLKOR", "Korean"),
  basket(1, "OLCHI", "Chinese"),
  basket(1, "OLRUS", "Russian"),
  // O/L basket II: aesthetic subjects and literature
  basket(2, "ART", "Art", ["primary", "junior", "ol"]),
  basket(2, "MUSE", "Eastern Music"),
  basket(2, "MUSW", "Western Music"),
  basket(2, "MUSC", "Carnatic Music"),
  basket(2, "DANE", "Eastern Dancing"),
  basket(2, "DANB", "Bharatha Dancing"),
  basket(2, "ELIT", "Appreciation of English Literary Texts"),
  basket(2, "SLIT", "Appreciation of Sinhala Literary Texts"),
  basket(2, "TLIT", "Appreciation of Tamil Literary Texts"),
  basket(2, "ALIT", "Appreciation of Arabic Literary Texts"),
  basket(2, "DRAM", "Drama and Theatre"),
  // O/L basket III: technical, practical and vocational subjects
  basket(3, "ICT", "Information & Communication Technology", ["junior", "ol"]),
  basket(3, "AGR", "Agriculture & Food Technology"),
  basket(3, "AQUA", "Aquatic Bioresources Technology"),
  basket(3, "CRAFT", "Arts & Crafts"),
  basket(3, "HOME", "Home Economics"),
  basket(3, "HPE", "Health & Physical Education", ["junior", "ol"]),
  basket(3, "MEDIA", "Communication & Media Studies"),
  basket(3, "DCON", "Design & Construction Technology"),
  basket(3, "DMEC", "Design & Mechanical Technology"),
  basket(3, "DELE", "Design, Electrical & Electronic Technology"),
  basket(3, "SHRT", "Electronic Writing & Shorthand"),
  // A/L, by subject number
  al("01", "PHY", "Physics"),
  al("02", "CHEM", "Chemistry"),
  al("07", "AMAT", "Mathematics"),
  al("08", "AGRI", "Agricultural Science"),
  al("09", "BIO", "Biology"),
  al("10", "CMATH", "Combined Mathematics"),
  al("11", "HMATH", "Higher Mathematics"),
  al("12", "CGT", "Common General Test"),
  al("13", "GENG", "General English"),
  al("14", "CIVT", "Civil Technology"),
  al("15", "MECT", "Mechanical Technology"),
  al("16", "EEIT", "Electrical, Electronic and Information Technology"),
  al("17", "FOOD", "Food Technology"),
  al("18", "AGRO", "Agro Technology"),
  al("19", "BIOR", "Bio Resource Technology"),
  al("20", "AICT", "Information & Communication Technology"),
  al("21", "ECON", "Economics"),
  al("22", "AGEO", "Geography"),
  al("23", "POL", "Political Science"),
  al("24", "LOGIC", "Logic and Scientific Method"),
  al("25A", "HISA", "History of Sri Lanka & India"),
  al("25B", "HISB", "History of Sri Lanka & Europe"),
  al("25C", "HISC", "History of Sri Lanka & Modern World"),
  al("28", "AHOME", "Home Economics"),
  al("29", "AMEDIA", "Communication & Media Studies"),
  al("31", "BSTAT", "Business Statistics"),
  al("32", "BST", "Business Studies"),
  al("33", "ACC", "Accounting"),
  al("41", "BUDD", "Buddhism"),
  al("42", "HIND", "Hinduism"),
  al("43", "CHRI", "Christianity"),
  al("44", "ISLM", "Islam"),
  al("45", "BCIV", "Buddhist Civilization"),
  al("46", "HCIV", "Hindu Civilization"),
  al("47", "ICIV", "Islam Civilization"),
  al("48", "GRCIV", "Greek and Roman Civilization"),
  al("49", "CCIV", "Christian Civilization"),
  al("51", "AART", "Art"),
  al("52", "DANI", "Dancing (Indigenous)"),
  al("53", "DANBH", "Dancing (Bharatha)"),
  al("54", "OMUS", "Oriental Music"),
  al("55", "CMUS", "Carnatic Music"),
  al("56", "WMUS", "Western Music"),
  al("57", "DRAS", "Drama and Theatre (Sinhala)"),
  al("58", "DRAT", "Drama and Theatre (Tamil)"),
  al("59", "DRAE", "Drama and Theatre (English)"),
  al("65", "ETEC", "Engineering Technology"),
  al("66", "BTEC", "Bio Systems Technology"),
  al("67", "SFT", "Science for Technology"),
  al("71", "ALSIN", "Sinhala"),
  al("72", "ALTAM", "Tamil"),
  al("73", "ALENG", "English"),
  al("74", "PALI", "Pali"),
  al("75", "SANS", "Sanskrit"),
  al("78", "ARAB", "Arabic"),
  al("79", "MALAY", "Malay"),
  al("81", "FREN", "French"),
  al("82", "GERM", "German"),
  al("83", "RUSS", "Russian"),
  al("84", "HINDI", "Hindi"),
  al("86", "CHIN", "Chinese"),
  al("87", "JAPA", "Japanese"),
  { code: "GIT", name: "General Information Technology", levels: AL },
];

/** Everyone in every A/L stream sits these. */
const AL_COMMON = ["GENG", "CGT"];

export interface CurriculumStream {
  code: string;
  name: string;
  /** Subjects everyone in the stream takes, including the common papers. */
  core: string[];
  /** Subjects students choose from. */
  options: string[];
  /** How many of the options each student takes. */
  optionsRequired: number;
}

const ARTS_OPTIONS = [
  "ALSIN", "ALTAM", "ALENG", "PALI", "SANS", "ARAB", "HINDI", "JAPA", "CHIN", "MALAY", "FREN", "GERM", "RUSS",
  "ECON", "AGEO", "HISA", "HISB", "HISC", "POL", "LOGIC", "AHOME", "AMEDIA",
  "BUDD", "BCIV", "HIND", "HCIV", "ISLM", "ICIV", "CHRI", "CCIV", "GRCIV",
  "AART", "DANI", "DANBH", "OMUS", "CMUS", "WMUS", "DRAS", "DRAT", "DRAE",
  "AMAT", "HMATH", "BSTAT", "AGRI",
];

export const CURRICULUM_STREAMS: CurriculumStream[] = [
  { code: "PS", name: "Physical Science", core: ["CMATH", "PHY", ...AL_COMMON], options: ["CHEM", "AICT"], optionsRequired: 1 },
  { code: "BS", name: "Biological Science", core: ["BIO", "CHEM", ...AL_COMMON], options: ["PHY", "AGRI"], optionsRequired: 1 },
  { code: "COM", name: "Commerce", core: AL_COMMON, options: ["ACC", "BST", "ECON", "BSTAT", "AICT", "AMAT"], optionsRequired: 3 },
  { code: "ART", name: "Arts", core: AL_COMMON, options: ARTS_OPTIONS, optionsRequired: 3 },
  { code: "ET", name: "Engineering Technology", core: ["ETEC", "SFT", ...AL_COMMON], options: ["CIVT", "MECT", "EEIT", "AICT", "AGEO", "AGRI", "AMAT"], optionsRequired: 1 },
  { code: "BT", name: "Bio Systems Technology", core: ["BTEC", "SFT", ...AL_COMMON], options: ["FOOD", "AGRO", "BIOR", "AICT", "AGEO", "AGRI", "AMAT"], optionsRequired: 1 },
];

export const gradeLevelOf = (gradeNumber: number): GradeLevel => (gradeNumber <= 5 ? "primary" : gradeNumber <= 9 ? "junior" : gradeNumber <= 11 ? "ol" : "al");

/** The one group of A/L options a stream's class has. */
export const AL_OPTIONS = "options";

/**
 * Which choice a subject belongs to in a class: null means everyone in the class takes it.
 * Primary and junior students take every subject their class offers, whatever it's called at O/L.
 */
export function optionGroupFor(level: GradeLevel, subject: { basket?: number | null; choiceGroup?: string | null }, inStream?: { optional: boolean }): string | null {
  if (level === "ol") return subject.basket ? `basket${subject.basket}` : (subject.choiceGroup ?? null);
  if (level === "al") return inStream?.optional ? AL_OPTIONS : null;
  return null;
}

/** Whether a new O/L or A/L class starts with this subject. Baskets and stream options are the school's to offer, so they're added as needed. */
export const startsInClass = (optionGroup: string | null | undefined) => !optionGroup || optionGroup === "first_language" || optionGroup === "religion";

/** Whether a student takes a class's subject. Students choose within a group; outside one, everyone takes it. */
export const sitsSubject = (optionGroup: string | null | undefined, subjectId: string, electives: { has(id: string): boolean }) => !optionGroup || electives.has(subjectId);

/** How many subjects a student takes from a group. */
export const picksFor = (optionGroup: string, optionsRequired: number) => (optionGroup === AL_OPTIONS ? optionsRequired : 1);

export interface OfferedSubject {
  subjectId: string;
  optionGroup?: string | null;
}

/** A student's choices kept to what the class offers. Other subjects in the list were chosen in another class, and don't apply. */
export function keepChoices(offered: OfferedSubject[], electives: string[]) {
  const choosable = new Set(offered.filter((s) => s.optionGroup).map((s) => s.subjectId));
  return [...new Set(electives)].filter((id) => choosable.has(id));
}

/** The group a student has chosen too many from, or null. Too few is allowed: schools collect choices over time. */
export function tooManyChoices(offered: OfferedSubject[], electives: string[], optionsRequired: number) {
  const chosen = new Set(electives);
  const counts = new Map<string, number>();
  for (const s of offered) if (s.optionGroup && chosen.has(s.subjectId)) counts.set(s.optionGroup, (counts.get(s.optionGroup) ?? 0) + 1);
  for (const [group, n] of counts) if (n > picksFor(group, optionsRequired)) return { group, allowed: picksFor(group, optionsRequired) };
  return null;
}

/** Whether a student still has choices to make in this class. */
export function missingChoices(offered: OfferedSubject[], electives: { has(id: string): boolean }, optionsRequired: number) {
  const groups = new Set(offered.flatMap((s) => (s.optionGroup ? [s.optionGroup] : [])));
  return [...groups].some((g) => offered.filter((s) => s.optionGroup === g && electives.has(s.subjectId)).length < picksFor(g, optionsRequired));
}
