// Branchenkatalog. Jede Branche wird über OpenStreetMap-Tags und/oder einen Namens-Regex gefunden.
// ma = typische Mitarbeiterzahl der Branche, dient nur als Basis für die grobe Schätzung.
const t = (k, v) => ({ k, v });

const BRANCHEN = [
  // ── Hochpreisige Produkte & Leistungen ──
  { id: 'kuechen', gruppe: 'hochpreis', label: 'Küchenstudios', ma: 8, tags: [t('shop', 'kitchen')], name: 'Küchenstudio|Küchenhaus|Einbauküchen' },
  { id: 'autohaus', gruppe: 'hochpreis', label: 'Autohäuser', ma: 25, tags: [t('shop', 'car')], name: 'Autohaus' },
  { id: 'wohnmobil', gruppe: 'hochpreis', label: 'Wohnmobile & Caravans', ma: 12, tags: [t('shop', 'caravan')], name: 'Wohnmobil|Caravan|Reisemobil' },
  { id: 'motorrad', gruppe: 'hochpreis', label: 'Motorradhändler', ma: 8, tags: [t('shop', 'motorcycle')] },
  { id: 'boote', gruppe: 'hochpreis', label: 'Boote & Yachten', ma: 8, tags: [t('shop', 'boat')], name: 'Bootsbau|Yachtservice|Bootswerft' },
  { id: 'moebel', gruppe: 'hochpreis', label: 'Möbel- & Einrichtungshäuser', ma: 15, tags: [t('shop', 'furniture'), t('shop', 'interior_decoration'), t('shop', 'bed')] },
  { id: 'juwelier', gruppe: 'hochpreis', label: 'Juweliere & Uhren', ma: 5, tags: [t('shop', 'jewelry'), t('shop', 'watches')] },
  { id: 'immobilien', gruppe: 'hochpreis', label: 'Immobilienmakler', ma: 6, tags: [t('office', 'estate_agent')] },
  { id: 'solar', gruppe: 'hochpreis', label: 'Solar & Photovoltaik', ma: 15, tags: [t('craft', 'photovoltaic'), t('craft', 'solar_energy')], name: 'Solar|Photovoltaik', nicht: 'Solarium|Solarpark|Sonnenstudio|Webdesign' },
  { id: 'fenster', gruppe: 'hochpreis', label: 'Fenster, Türen & Tore', ma: 12, tags: [t('craft', 'window_construction'), t('shop', 'doors'), t('shop', 'windows'), t('craft', 'glaziery')], name: 'Fensterbau|Fenster und Türen|Fenster & Türen|Torbau' },
  { id: 'wintergarten', gruppe: 'hochpreis', label: 'Wintergärten & Terrassendächer', ma: 10, tags: [], name: 'Wintergarten|Wintergärten|Terrassendach|Terrassendächer|Überdachung' },
  { id: 'shk', gruppe: 'hochpreis', label: 'Heizung, Sanitär & Bad', ma: 10, tags: [t('craft', 'plumber'), t('craft', 'hvac'), t('craft', 'heating_engineer'), t('shop', 'bathroom_furnishing')], name: 'Heizungsbau|Sanitär|Wärmepumpe|Badstudio' },
  { id: 'kamin', gruppe: 'hochpreis', label: 'Kamine & Öfen', ma: 6, tags: [t('shop', 'fireplace'), t('craft', 'stove_fitter')], name: 'Kaminbau|Kaminstudio|Ofenbau|Kachelofen' },
  { id: 'pool', gruppe: 'hochpreis', label: 'Pool, Sauna & Wellness', ma: 8, tags: [t('shop', 'swimming_pool')], name: 'Poolbau|Schwimmbadbau|Schwimmbadtechnik|Saunabau|Whirlpool' },
  { id: 'galabau', gruppe: 'hochpreis', label: 'Garten- & Landschaftsbau', ma: 12, tags: [t('craft', 'gardener'), t('craft', 'landscaper')], name: 'Garten- und Landschaftsbau|Galabau|GaLaBau|Gartengestaltung' },
  { id: 'bau', gruppe: 'hochpreis', label: 'Bauunternehmen & Hausbau', ma: 25, tags: [t('craft', 'builder'), t('office', 'construction_company'), t('craft', 'construction')], name: 'Bauunternehmen|Bauunternehmung|Massivhaus|Fertighaus|Hausbau|Bauträger' },
  { id: 'dach', gruppe: 'hochpreis', label: 'Dachdecker & Zimmereien', ma: 12, tags: [t('craft', 'roofer'), t('craft', 'carpenter')], name: 'Dachdecker|Bedachung|Zimmerei|Holzbau' },
  { id: 'schreiner', gruppe: 'hochpreis', label: 'Schreiner & Tischler', ma: 8, tags: [t('craft', 'joiner'), t('craft', 'cabinet_maker')], name: 'Schreinerei|Tischlerei|Möbelwerkstatt|Innenausbau' },
  { id: 'elektro', gruppe: 'hochpreis', label: 'Elektroinstallation & Gebäudetechnik', ma: 12, tags: [t('craft', 'electrician')], name: 'Elektrotechnik|Elektroinstallation|Gebäudetechnik' },
  { id: 'metallbau', gruppe: 'hochpreis', label: 'Metall- & Treppenbau', ma: 15, tags: [t('craft', 'metal_construction'), t('craft', 'blacksmith')], name: 'Metallbau|Stahlbau|Treppenbau|Schlosserei' },
  { id: 'boden', gruppe: 'hochpreis', label: 'Bodenbeläge & Parkett', ma: 8, tags: [t('shop', 'flooring'), t('craft', 'floorer'), t('craft', 'parquet_layer')], name: 'Parkett|Bodenbeläge' },
  { id: 'zahnarzt', gruppe: 'hochpreis', label: 'Zahnärzte & Kieferorthopäden', ma: 10, tags: [t('amenity', 'dentist'), t('healthcare', 'dentist')] },
  { id: 'aesthetik', gruppe: 'hochpreis', label: 'Ästhetik & Privatkliniken', ma: 12, tags: [t('healthcare:speciality', 'plastic_surgery')], name: 'Ästhetik|Schönheitsklinik|Privatklinik|Plastische Chirurgie|Haartransplantation' },
  { id: 'hoerakustik', gruppe: 'hochpreis', label: 'Hörakustiker', ma: 5, tags: [t('shop', 'hearing_aids')] },
  { id: 'optiker', gruppe: 'hochpreis', label: 'Optiker', ma: 6, tags: [t('shop', 'optician')] },
  { id: 'ebike', gruppe: 'hochpreis', label: 'Fahrrad- & E-Bike-Händler', ma: 8, tags: [t('shop', 'bicycle')] },
  { id: 'architekt', gruppe: 'hochpreis', label: 'Architekten & Ingenieurbüros', ma: 8, tags: [t('office', 'architect'), t('office', 'engineer')] },
  { id: 'finanz', gruppe: 'hochpreis', label: 'Finanz- & Versicherungsberater', ma: 5, tags: [t('office', 'insurance'), t('office', 'financial_advisor'), t('office', 'financial')] },
  { id: 'landtechnik', gruppe: 'hochpreis', label: 'Land- & Baumaschinen', ma: 20, tags: [t('shop', 'agrarian'), t('shop', 'tractor')], name: 'Landtechnik|Landmaschinen|Baumaschinen' },

  // ── Branchen mit hohem Personalbedarf ──
  { id: 'physio', gruppe: 'personal', label: 'Physiotherapie', ma: 7, tags: [t('healthcare', 'physiotherapist')], name: 'Physiotherapie|Krankengymnastik' },
  { id: 'ergo', gruppe: 'personal', label: 'Ergotherapie', ma: 6, tags: [t('healthcare', 'occupational_therapist')], name: 'Ergotherapie' },
  { id: 'logo', gruppe: 'personal', label: 'Logopädie', ma: 5, tags: [t('healthcare', 'speech_therapist')], name: 'Logopädie|Sprachtherapie' },
  { id: 'pflege', gruppe: 'personal', label: 'Pflegedienste & Pflegeheime', ma: 45, tags: [t('amenity', 'nursing_home'), t('social_facility', 'nursing_home'), t('social_facility', 'assisted_living'), t('social_facility', 'ambulatory_care'), t('healthcare', 'nursing'), t('healthcare', 'nurse')], name: 'Pflegedienst|Seniorenresidenz|Tagespflege|Intensivpflege' },
  { id: 'arzt', gruppe: 'personal', label: 'Arztpraxen & MVZ', ma: 7, tags: [t('amenity', 'doctors'), t('healthcare', 'doctor'), t('amenity', 'clinic'), t('healthcare', 'clinic')] },
  { id: 'tierarzt', gruppe: 'personal', label: 'Tierärzte', ma: 8, tags: [t('amenity', 'veterinary')] },
  { id: 'apotheke', gruppe: 'personal', label: 'Apotheken', ma: 10, tags: [t('amenity', 'pharmacy')] },
  { id: 'sanitaetshaus', gruppe: 'personal', label: 'Sanitätshäuser & Orthopädietechnik', ma: 12, tags: [t('shop', 'medical_supply'), t('craft', 'orthopaedics')], name: 'Sanitätshaus|Orthopädietechnik' },
  { id: 'kita', gruppe: 'personal', label: 'Kitas (private Träger)', ma: 15, tags: [t('amenity', 'kindergarten'), t('amenity', 'childcare')] },
  { id: 'gastro', gruppe: 'personal', label: 'Restaurants & Gastronomie', ma: 10, tags: [t('amenity', 'restaurant')] },
  { id: 'hotel', gruppe: 'personal', label: 'Hotels', ma: 25, tags: [t('tourism', 'hotel')] },
  { id: 'baeckerei', gruppe: 'personal', label: 'Bäckereien & Konditoreien', ma: 20, tags: [t('shop', 'bakery'), t('shop', 'pastry'), t('craft', 'bakery')] },
  { id: 'metzgerei', gruppe: 'personal', label: 'Metzgereien', ma: 12, tags: [t('shop', 'butcher')] },
  { id: 'friseur', gruppe: 'personal', label: 'Friseure', ma: 5, tags: [t('shop', 'hairdresser')] },
  { id: 'kosmetik', gruppe: 'personal', label: 'Kosmetik- & Beautystudios', ma: 4, tags: [t('shop', 'beauty')] },
  { id: 'kfz', gruppe: 'personal', label: 'Kfz-Werkstätten', ma: 8, tags: [t('shop', 'car_repair')] },
  { id: 'spedition', gruppe: 'personal', label: 'Speditionen & Logistik', ma: 40, tags: [t('office', 'logistics'), t('office', 'forwarder'), t('office', 'moving_company')], name: 'Spedition|Logistik|Transporte|Umzüge' },
  { id: 'reinigung', gruppe: 'personal', label: 'Gebäudereinigung', ma: 40, tags: [t('craft', 'cleaning'), t('office', 'cleaning')], name: 'Gebäudereinigung|Gebäudeservice|Gebäudedienste' },
  { id: 'sicherheit', gruppe: 'personal', label: 'Sicherheitsdienste', ma: 40, tags: [t('office', 'security')], name: 'Sicherheitsdienst|Wachschutz|Security' },
  { id: 'maler', gruppe: 'personal', label: 'Maler & Stuckateure', ma: 8, tags: [t('craft', 'painter'), t('craft', 'plasterer')], name: 'Malerbetrieb|Malermeister|Stuckateur' },
  { id: 'fliesen', gruppe: 'personal', label: 'Fliesenleger', ma: 6, tags: [t('craft', 'tiler')], name: 'Fliesenleger|Fliesenfachbetrieb' },
  { id: 'industrie', gruppe: 'personal', label: 'Industrie & Produktion', ma: 80, tags: [t('man_made', 'works'), t('office', 'company')], name: 'Maschinenbau|Anlagenbau|Werkzeugbau|Kunststofftechnik|Zerspanung' },
  { id: 'it', gruppe: 'personal', label: 'IT & Software', ma: 15, tags: [t('office', 'it'), t('office', 'software')], name: 'Software|IT-Service|Systemhaus' },
  { id: 'steuer', gruppe: 'personal', label: 'Steuerberater', ma: 10, tags: [t('office', 'tax_advisor'), t('office', 'accountant')] },
  { id: 'recht', gruppe: 'personal', label: 'Rechtsanwälte & Notare', ma: 8, tags: [t('office', 'lawyer'), t('office', 'notary')] },
  { id: 'fitness', gruppe: 'personal', label: 'Fitnessstudios', ma: 12, tags: [t('leisure', 'fitness_centre')] },
  { id: 'fahrschule', gruppe: 'personal', label: 'Fahrschulen', ma: 6, tags: [t('amenity', 'driving_school')] },
];

// ── Vollständiger Katalog ──
// Damit keine Branche außen vor bleibt, folgen hier alle übrigen Kategorien, die OpenStreetMap für Betriebe kennt.
// Schreibweise je Zeile: id | Gruppe | Bezeichnung | typische Mitarbeiterzahl | OSM-Tags | zusätzliche Suchwörter
// Ein Tag ohne Wert („shop“) steht für die ganze Kategorie und fängt alles auf, was keinen eigenen Eintrag hat.
const WEITERE = `
supermarkt | handel | Supermärkte & Lebensmittel | 30 | shop=supermarket shop=convenience shop=greengrocer shop=deli shop=farm shop=health_food shop=organic shop=seafood shop=cheese | lebensmittel bioladen hofladen feinkost obst gemüse
getraenke | handel | Getränke, Wein & Spirituosen | 6 | shop=beverages shop=alcohol shop=wine | getränkemarkt weinhandel vinothek
suesswaren | handel | Süßwaren, Kaffee & Tee | 4 | shop=confectionery shop=chocolate shop=coffee shop=tea | pralinen rösterei
kiosk | handel | Kioske, Tabak & Lotto | 3 | shop=kiosk shop=tobacco shop=newsagent shop=lottery shop=e-cigarette | zeitschriften
mode | handel | Mode & Bekleidung | 8 | shop=clothes shop=boutique shop=fashion_accessories shop=bag shop=leather shop=bridal | kleidung textil brautmoden
schuhe | handel | Schuhgeschäfte | 6 | shop=shoes | schuhhaus
drogerie | handel | Drogerien & Parfümerien | 12 | shop=chemist shop=cosmetics shop=perfumery | drogeriemarkt
blumen | handel | Blumen & Gartencenter | 6 | shop=florist shop=garden_centre | florist gärtnerei pflanzen
baumarkt | handel | Baumärkte & Baustoffhandel | 30 | shop=doityourself shop=hardware shop=trade shop=paint shop=building_materials | baustoffe eisenwaren werkzeug farben
elektronik | handel | Elektronik, Computer & Handy | 8 | shop=electronics shop=computer shop=mobile_phone shop=hifi shop=appliance shop=vacuum_cleaner | elektrofachmarkt haushaltsgeräte pc smartphone
wohnen | handel | Wohnaccessoires, Stoffe & Haushalt | 6 | shop=houseware shop=lighting shop=curtain shop=carpet shop=window_blind shop=fabric shop=sewing | lampen gardinen teppich haushaltswaren
kunst | handel | Kunst, Antiquitäten & Rahmen | 3 | shop=art shop=antiques shop=frame | galerie
buecher | handel | Bücher, Schreibwaren & Bastelbedarf | 5 | shop=books shop=stationery shop=craft | buchhandlung bürobedarf
spielwaren | handel | Spielwaren & Babyausstattung | 6 | shop=toys shop=games shop=baby_goods | spielzeug
sport | handel | Sport, Outdoor, Jagd & Angeln | 8 | shop=sports shop=outdoor shop=fishing shop=hunting shop=weapons shop=golf shop=scuba_diving | sportgeschäft waffen
tierbedarf | handel | Tierbedarf & Hundesalons | 5 | shop=pet shop=pet_grooming | zoohandlung hundefriseur
geschenke | handel | Geschenke, Sonderposten & Secondhand | 4 | shop=gift shop=variety_store shop=second_hand shop=charity | souvenirs
musik | handel | Musik, Foto & Video | 4 | shop=musical_instrument shop=music shop=photo shop=video shop=video_games | musikhaus instrumente fotogeschäft
reisebuero | handel | Reisebüros | 4 | shop=travel_agency office=travel_agent | reisen urlaub
bestatter | handel | Bestattungsunternehmen | 6 | shop=funeral_directors | bestatter beerdigung
waescherei | handel | Wäschereien, Reinigungen & Schneidereien | 5 | shop=laundry shop=dry_cleaning shop=tailor craft=tailor craft=dressmaker | textilreinigung schneider änderungsschneiderei
copyshop | handel | Copyshops & Druckereien | 8 | shop=copyshop craft=printer craft=bookbinder | druck
massage | handel | Massage-, Tattoo- & Sonnenstudios | 3 | shop=massage shop=tattoo leisure=tanning_salon leisure=sauna | piercing solarium wellness
sicherheitstechnik | handel | Sicherheitstechnik & Schlüsseldienste | 6 | shop=security shop=locksmith craft=locksmith craft=key_cutter | alarmanlagen schlüsseldienst
handel-sonst | handel | Sonstiger Einzelhandel | 5 | shop | laden geschäft händler
steinmetz | handwerk | Steinmetze | 6 | craft=stonemason | grabsteine naturstein
geruest | handwerk | Gerüstbau & Dämmung | 12 | craft=scaffolder craft=insulation | gerüstbauer wärmedämmung
spengler | handwerk | Spenglereien | 8 | craft=tinsmith | flaschner blechner
polsterer | handwerk | Polsterer, Raumausstatter & Sattler | 4 | craft=upholsterer craft=saddler craft=carpet_layer | polsterei
schuhmacher | handwerk | Schuhmacher, Uhrmacher & Reparaturdienste | 3 | craft=shoemaker craft=watchmaker craft=electronics_repair shop=repair shop=shoe_repair | schuster reparatur
goldschmied | handwerk | Goldschmiede | 3 | craft=goldsmith craft=jeweller | schmuckatelier
zahntechnik | handwerk | Zahntechnik-Labore | 10 | craft=dental_technician | dentallabor
fotograf | handwerk | Fotografen | 3 | craft=photographer craft=photographic_laboratory | fotostudio
werbetechnik | handwerk | Werbetechnik & Schilder | 6 | craft=signmaker | beschriftung folierung
kunsthandwerk | handwerk | Kunsthandwerk, Ateliers & Instrumentenbau | 2 | craft=pottery craft=sculptor craft=glassblower craft=handicraft craft=atelier craft=basket_maker craft=musical_instrument craft=piano_tuner craft=organ_builder | töpferei keramik
brauerei | handwerk | Brauereien, Brennereien & Weingüter | 15 | craft=brewery craft=distillery craft=winery | weingut winzer
catering | handwerk | Catering & Lebensmittelhandwerk | 8 | craft=caterer craft=confectionery craft=butcher craft=beekeeper | partyservice imker
saegewerk | handwerk | Sägewerke & Holzverarbeitung | 15 | craft=sawmill craft=cooper | holz
schornstein | handwerk | Schornsteinfeger | 3 | craft=chimney_sweeper | kaminkehrer
schaedling | handwerk | Schädlingsbekämpfung | 5 | craft=pest_control | kammerjäger
handwerk-sonst | handwerk | Sonstiges Handwerk | 6 | craft | handwerker handwerksbetrieb
krankenhaus | gesundheit | Krankenhäuser & Reha-Kliniken | 400 | amenity=hospital healthcare=hospital healthcare=rehabilitation | klinik reha
psycho | gesundheit | Psychotherapie & Beratung | 3 | healthcare=psychotherapist healthcare=counselling office=therapist | psychologe coaching
heilpraktiker | gesundheit | Heilpraktiker & Osteopathie | 2 | healthcare=alternative | osteopath naturheilkunde
podologie | gesundheit | Podologie & Fußpflege | 3 | healthcare=podiatrist | fusspflege
hebamme | gesundheit | Hebammen | 2 | healthcare=midwife | geburtshaus
labor | gesundheit | Labore & Diagnostik | 30 | healthcare=laboratory | medizinisches labor
gesundheit-sonst | gesundheit | Sonstige Gesundheitsberufe | 4 | healthcare | therapeut praxis
personal-dl | buero | Personaldienstleister & Zeitarbeit | 15 | office=employment_agency | zeitarbeit personalvermittlung recruiting headhunter
werbeagentur | buero | Werbe-, Marketing- & Designagenturen | 8 | office=advertising_agency office=graphic_design office=web_design | marketing agentur grafik webdesign
beratung | buero | Unternehmensberatungen | 8 | office=consulting | consulting berater
hausverwaltung | buero | Hausverwaltungen | 8 | office=property_management | immobilienverwaltung
gutachter | buero | Gutachter & Vermessungsbüros | 5 | office=surveyor | sachverständiger vermessung
energie | buero | Energieversorger & Telekommunikation | 50 | office=energy_supplier office=telecommunication office=water_utility | stadtwerke strom
verlag | buero | Verlage & Medien | 15 | office=newspaper office=publisher | zeitung
bank | buero | Banken & Sparkassen | 20 | amenity=bank office=bank | sparkasse volksbank
coworking | buero | Coworking & Tagungsstätten | 4 | office=coworking amenity=coworking_space amenity=conference_centre amenity=events_venue | eventlocation
verband | buero | Verbände, Vereine & Stiftungen | 6 | office=association office=foundation office=ngo office=charity | verein
buero-sonst | buero | Sonstige Büros & Dienstleister | 8 | office | dienstleister büro firma
cafe | gastro | Cafés, Eisdielen & Imbisse | 6 | amenity=cafe amenity=ice_cream amenity=fast_food amenity=food_court | imbiss döner pizzeria eiscafé
bar | gastro | Bars, Kneipen & Clubs | 6 | amenity=bar amenity=pub amenity=biergarten amenity=nightclub | kneipe diskothek
pension | gastro | Pensionen, Ferienwohnungen & Camping | 4 | tourism=guest_house tourism=hostel tourism=apartment tourism=chalet tourism=motel tourism=camp_site tourism=caravan_site | ferienhaus campingplatz
kino | gastro | Kinos, Theater & Freizeitbetriebe | 15 | amenity=cinema amenity=theatre amenity=casino tourism=theme_park tourism=zoo leisure=bowling_alley leisure=escape_game leisure=amusement_arcade leisure=miniature_golf leisure=trampoline_park leisure=water_park leisure=indoor_play | spielhalle bowling freizeitpark
sportanlage | gastro | Sportzentren, Golf, Tanz & Reiterhöfe | 8 | leisure=sports_centre leisure=golf_course leisure=horse_riding leisure=marina leisure=dance | reitstall tennishalle tanzschule
autoteile | verkehr | Autoteile, Reifen & Anhänger | 6 | shop=car_parts shop=tyres shop=trailer | reifenhandel ersatzteile
tankstelle | verkehr | Tankstellen & Waschanlagen | 6 | amenity=fuel amenity=car_wash | waschstrasse
autovermietung | verkehr | Autovermietung, Taxi & Verleih | 8 | amenity=car_rental amenity=taxi office=taxi shop=rental | mietwagen
schule-privat | bildung | Sprach-, Musik- & Nachhilfeschulen | 8 | amenity=language_school amenity=music_school amenity=dancing_school amenity=prep_school amenity=training office=tutoring office=educational_institution | nachhilfe weiterbildung akademie
tierbetreuung | bildung | Tierpensionen & Hundeschulen | 3 | amenity=animal_boarding amenity=animal_training amenity=animal_shelter | hundeschule hundepension
sozial | bildung | Soziale Einrichtungen & Beratungsstellen | 20 | amenity=social_facility amenity=social_centre | jugendhilfe behindertenhilfe
grosshandel | industrie | Großhandel | 20 | shop=wholesale | grosshändler
lager | industrie | Lager & Selfstorage | 5 | shop=storage_rental | lagerraum
`;
const zuTags = (text) => text.trim().split(/\s+/).map((paar) => { const [k, v] = paar.split('='); return v === undefined ? { k } : { k, v }; });
const SUCHWORTE_WEITERE = {};
for (const zeile of WEITERE.trim().split('\n')) {
  const [id, gruppe, label, ma, tags, worte = ''] = zeile.split('|').map((s) => s.trim());
  BRANCHEN.push({ id, gruppe, label, ma: +ma, tags: zuTags(tags) });
  SUCHWORTE_WEITERE[id] = worte;
}
// Auffang-Einträge („Sonstige …“) gehören ans Ende, damit die genaueren Bezeichnungen zuerst greifen.
const istAuffang = (b) => b.tags.some((t) => t.v === undefined);
BRANCHEN.sort((a, b) => istAuffang(a) - istAuffang(b));
// Ergänzungen bestehender Einträge
const ergaenze = (id, tags) => BRANCHEN.find((b) => b.id === id).tags.push(...zuTags(tags));
ergaenze('boote', 'craft=boatbuilder craft=sailmaker');
ergaenze('landtechnik', 'craft=agricultural_engines');
ergaenze('industrie', 'craft=toolmaker');

const GRUPPEN = {
  hochpreis: 'Hochpreisige Produkte', personal: 'Hoher Personalbedarf', handel: 'Einzelhandel', handwerk: 'Weiteres Handwerk',
  gesundheit: 'Weitere Gesundheitsberufe', buero: 'Büro & Dienstleistung', gastro: 'Gastronomie, Unterkunft & Freizeit',
  verkehr: 'Auto & Verkehr', bildung: 'Bildung, Soziales & Tiere', industrie: 'Großhandel & Lager',
};
// Einträge, die keine Unternehmen sind (Behörden, Parteien, leere Läden)
const KEIN_UNTERNEHMEN = { office: ['government', 'diplomatic', 'political_party', 'religion', 'administrative', 'quango', 'parish', 'yes', 'no'], shop: ['vacant', 'no', 'yes'], craft: ['no', 'yes'], healthcare: ['no', 'yes', 'blood_donation'] };

// Suchwörter, unter denen eine Branche in der Suchzeile zusätzlich gefunden wird (Alltagsbegriffe, Abkürzungen, Einzahl).
const SUCHWORTE = {
  kuechen: 'küche küchen küchenbauer einbauküche', autohaus: 'auto autos autohändler kfz-handel pkw gebrauchtwagen neuwagen', wohnmobil: 'camper camping wohnwagen',
  motorrad: 'motorräder roller bike', boote: 'boot yacht segeln werft', moebel: 'möbelhaus einrichtung betten matratzen sofa', juwelier: 'schmuck uhren goldschmied trauringe',
  immobilien: 'makler immobilienmakler hausverkauf', solar: 'pv photovoltaik solaranlage solarteur energie', fenster: 'fensterbauer türen tore glaser glaserei rollladen',
  wintergarten: 'terrasse überdachung carport markise', shk: 'heizung sanitär klempner installateur bad badsanierung wärmepumpe klima lüftung heizungsbauer', kamin: 'ofen kaminofen kachelofen ofenbauer',
  pool: 'schwimmbad sauna whirlpool wellness', galabau: 'gärtner gartenbau landschaftsbau garten gartengestaltung', bau: 'baufirma bauunternehmer hausbau fertighaus massivhaus bauträger rohbau maurer',
  dach: 'dachdecker zimmerer zimmerei holzbau bedachung spengler', schreiner: 'tischler schreinerei tischlerei möbelbau innenausbau', elektro: 'elektriker elektroinstallateur elektrotechnik smart home',
  metallbau: 'schlosser schlosserei stahlbau treppen treppenbau geländer', boden: 'parkett bodenleger laminat teppich estrich', zahnarzt: 'zahnarzt zahnärztin kieferorthopäde implantate dental zahnmedizin',
  aesthetik: 'schönheitschirurgie schönheitsklinik beauty-klinik hautarzt plastische chirurgie', hoerakustik: 'hörgeräte hörgeräteakustiker akustiker', optiker: 'brillen augenoptiker kontaktlinsen',
  ebike: 'fahrrad fahrräder e-bike bike zweirad', architekt: 'architekt architekturbüro ingenieur planungsbüro statiker bauingenieur', finanz: 'versicherung versicherungsmakler finanzberater vermögensberater makler',
  landtechnik: 'traktor landmaschinen baumaschinen agrar', physio: 'physiotherapeut krankengymnastik massage therapie reha', ergo: 'ergotherapeut therapie', logo: 'logopäde sprachtherapie therapie',
  pflege: 'pflegedienst pflegeheim altenheim seniorenheim altenpflege tagespflege ambulant', arzt: 'arzt ärzte hausarzt praxis mvz facharzt klinik', tierarzt: 'tierarzt tierklinik veterinär',
  apotheke: 'apotheker pharmazie', sanitaetshaus: 'orthopädie orthopädietechnik reha-technik prothesen', kita: 'kindergarten kindertagesstätte krippe kinderbetreuung',
  gastro: 'restaurant gaststätte gastronomie wirtshaus essen küche koch', hotel: 'hotels pension unterkunft gasthof', baeckerei: 'bäcker konditor konditorei café', metzgerei: 'metzger fleischer fleischerei',
  friseur: 'frisör friseursalon haare barbier barber', kosmetik: 'beauty nagelstudio kosmetikerin wimpern', kfz: 'werkstatt autowerkstatt kfz-werkstatt mechaniker reifen autoreparatur',
  spedition: 'logistik transport umzug lkw fuhrunternehmen', reinigung: 'reinigungsfirma putzfirma gebäudereiniger facility', sicherheit: 'security wachdienst objektschutz',
  maler: 'malerbetrieb lackierer stuckateur anstrich tapezieren', fliesen: 'fliesenleger fliesen', industrie: 'produktion fertigung maschinenbau fabrik werk hersteller zerspanung',
  it: 'software softwareentwicklung systemhaus edv computer agentur', steuer: 'steuerberater steuerkanzlei buchhaltung wirtschaftsprüfer', recht: 'anwalt rechtsanwalt kanzlei notar',
  fitness: 'fitnessstudio gym sport training', fahrschule: 'führerschein fahrlehrer',
};
for (const b of BRANCHEN) {
  b.suche = [b.label, (b.name || '').replace(/\|/g, ' '), SUCHWORTE[b.id] || '', SUCHWORTE_WEITERE[b.id] || ''].join(' ').toLowerCase();
  b.gruppeLabel = GRUPPEN[b.gruppe];
}

module.exports = BRANCHEN;
module.exports.KEIN_UNTERNEHMEN = KEIN_UNTERNEHMEN;
