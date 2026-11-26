import { Apple, Beef, Beer, Candy, Cherry, Coffee, Cookie, Croissant, CupSoda, Egg, Fish, Flame, GlassWater, IceCream, Martini, Milk, Package, Pizza, Popcorn, Salad, Sandwich, Soup, Utensils, Wine, type LucideIcon } from 'lucide-react';

/** Rein optisch: Symbol nach Artikelname für Kacheln ohne Bild. Ändert keine Daten. Erste passende Regel gewinnt. */
const RULES: Array<[RegExp, LucideIcon]> = [
  [/glühwein|punsch|grog|heiß|heiss/, Flame],
  [/kaffee|cappuccino|espresso|latte|kakao|schokolade|tee\b/, Coffee],
  [/bier|radler|hefe|pils|weizen|helles|märzen|alster/, Beer],
  [/sekt|prosecco|champagner|spritz|aperol|cocktail|likör|schnaps|zirbe|obstler|mirabelle|williams|vodka|gin\b|rum\b|whisk|schuss|korn/, Martini],
  [/wein|weiß|rosé|rot\b|secco|most\b|traube/, Wine],
  [/cola|fanta|sprite|limo|schorle|saft|spezi|energy|eistee/, CupSoda],
  [/wasser|sprudel|mineral/, GlassWater],
  [/milch|sahne|joghurt/, Milk],
  [/wurst|bratwurst|burger|steak|fleisch|schinken|speck|leberkäs|currywurst|grill/, Beef],
  [/fisch|lachs|forelle|scampi|garnele/, Fish],
  [/pizza|flammkuchen|pommes|fritten/, Pizza],
  [/brot|semmel|brezel|breze|croissant|kipferl|laugen/, Croissant],
  [/sandwich|toast|baguette|wrap/, Sandwich],
  [/suppe|eintopf|gulasch|chili|raclette|fondue|käse/, Soup],
  [/salat/, Salad],
  [/ei\b|eier/, Egg],
  [/waffel|kuchen|keks|plätzchen|lebkuchen|donut|krapfen|strudel|torte|gebäck|muffin/, Cookie],
  [/eis\b|eiscreme|sorbet/, IceCream],
  [/popcorn|chips|nuss|nüsse|mandel/, Popcorn],
  [/bonbon|zucker|schoko|süß|zuckerwatte|lolli/, Candy],
  [/kirsch|beere|erdbeer|himbeer|obst/, Cherry],
  [/apfel|birne|banane|orange/, Apple],
  [/pfand|becher|tasse|teller|besteck/, Utensils],
];

export function productIconFor(name: string): LucideIcon {
  const lower = name.toLocaleLowerCase('de-DE');
  for (const [pattern, icon] of RULES) if (pattern.test(lower)) return icon;
  return Package;
}
