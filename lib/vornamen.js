// Vornamenlisten. Dienen dazu, echte Personennamen von anderem Text zu unterscheiden
// und – nur bei eindeutigen Namen – die Anrede (Herr/Frau) abzuleiten.
const liste = (s) => new Set(s.toLowerCase().split(/\s+/).filter(Boolean));

const MAENNLICH = liste(`
achim adam adrian albert albrecht alfons alfred ali alois andre andré andreas anton armin arne arnd arndt arnold arthur artur august axel
bastian ben benedikt benjamin benno bernd bernhard bert berthold björn bodo boris bruno burkhard carl carsten christian christof christoph christopher
claus clemens cornelius daniel david dennis denis detlef detlev dieter dietmar dietrich dirk dominik eberhard eckhard eckart edgar edmund eduard egon
elmar emil emanuel enno erhard eric erich erik ernst erwin eugen ewald fabian falk felix ferdinand finn fynn florian frank franz fred frederik fridolin
friedhelm friedrich fritz gabriel georg gerald gerd gereon gerhard gernot gero gert gottfried götz gregor guido günter günther gunnar gunter gunther gustav
hagen hajo hannes hanno hans harald hartmut hartwig hauke heiko heiner heino heinrich heinz helge helmut helmuth hendrik henner henning henri henrik henry
herbert hermann hinrich holger horst hubert hubertus hugo ignaz ingmar ingo ingolf jakob jan jannes jannik jannis janis jens joachim jochen joerg jörg
johann johannes jonas jonathan jörn josef joseph joshua jost julian julius jürgen juergen justus karl karlheinz karsten kaspar kevin kilian klaus klemens
knut konrad konstantin kuno kurt lars laurenz leif lennard lennart leo leon leonard leonhard leopold linus lorenz lothar louis ludger ludwig lukas lucas lutz
maik malte manfred manuel marc marcel marco marcus mario marius mark marko markus martin marvin mathias mats matthias mattias max maximilian meinhard
michael michel mike mirco mirko moritz nico niklas nikolas nicolas nicolai nikolai nikolaus nils norbert norman olaf ole oliver oskar oswald otmar ottmar otto
pascal patrick paul peter philip philipp phillip pierre piet rafael raimund rainald rainer ralf ralph raphael reimund reiner reinhard reinhold rene rené
richard rico robert rochus roger roland rolf roman ronald ronny rüdiger ruediger rudi rudolf rupert ruprecht sebastian siegfried siegmund sigurd silvio simon
sönke sören stefan steffen stephan steven sven swen theo theodor thilo thomas thore thorsten tillmann tilman till tilo tim timo tino titus tobias tom tomas
torben torsten tristan udo ulf ullrich ulrich urs uwe valentin veit viktor victor vincent vinzenz volker walter walther waldemar wendelin werner wieland
wilfried wilhelm willi willy winfried wolf wolfgang wolfram wulf xaver yannick yannik
ahmet mehmet mustafa murat hasan hüseyin ibrahim ismail osman yusuf emre burak serkan erkan hakan volkan cem kemal orhan ömer omer ramazan recep selim sinan
tolga ugur uğur yilmaz bülent erdal erol fatih gökhan halil ilker kadir levent metin onur özgür sedat süleyman tuncay turgut ümit engin ercan erdem ferhat
mohamed mohammed mohammad muhammed ahmed ahmad omar khaled hassan hussein karim samir tarek tarik walid youssef amir reza mahmoud bilal
giovanni giuseppe antonio francesco luigi salvatore vincenzo angelo roberto marcello massimo stefano paolo pietro sergio claudio fabio enzo carlo franco
dario davide domenico emilio enrico lorenzo matteo riccardo alessandro carmelo gianni giorgio mauro maurizio nicolo pasquale raffaele rocco
carlos josé jose juan miguel pedro pablo luis javier fernando diego jorge joao
dimitrios georgios ioannis konstantinos nikolaos panagiotis vasilios christos stavros athanasios
andrzej piotr krzysztof tomasz pawel paweł marek jacek grzegorz wojciech mariusz dariusz zbigniew jerzy stanislaw lukasz marcin rafal jaroslaw
miroslav milan goran zoran dragan dejan nenad darko ivan igor oleg sergej sergei dimitri dmitri wladimir vladimir alexej andrej juri vitali
besnik arben agim bekim fatmir alexander aleksander
john james william george charles edward brian steve jeff scott greg tony jim bob bill joe nick jack harry ryan jason justin aaron elias levi dave
albin aloys alwin anselm bartholomäus benedict bernard berndt bertram cord cornel diethelm eckehard eckhardt egbert ekkehard engelbert erasmus
friedemann friedbert gebhard gerold gerwin gisbert gotthard gottlieb heimo heribert hilmar immanuel isidor jobst jupp kajetan kasimir korbinian lambert
leander lienhard ludolf luitpold magnus marinus meinolf meinrad nepomuk norwin notker ortwin oswin pankraz quirin raik randolf reimar reinald remigius
rigobert rudolph rupprecht sepp severin sigmar sigismund sixtus stanislaus tassilo thaddäus theobald traugott vitus volkmar volkhard walfried wenzel
wigbert wilfrid willibald wilmar wolfhard wunibald zacharias alessio amon arian bela bjarne cedric colin constantin damian danny dean domenic dustin eddy
elia elian emilian etienne falko fiete florin gian gino giuliano jannick janek janosch jarno jaron jasper jerome joel jonah jonte joris josua julien kalle
keno kjell lasse laurin lenny leonardo levin liam lias lion luan luc lucian luka maddox malik marlon marten matheo mathis mattis maurice maxim mert micha
milo mio nevio nick niclas niko nino noel oscar phil quentin ruben sami samuel silas tamino thies tiago tjard tyler yannis yunus andy benny bernie charly
freddy hansi heini jo jonny manni matze ralfi rolli stephen stefano timm tobi wolle ludwig-wilhelm arno arnulf burkhart dietger edwin erwin falk frieder
gerrit gilbert gotthold gundolf harro hartmann heinz-peter henrich herwig hubertus ingbert isko jaroslav joschka kay-uwe lajos laszlo istvan zoltan attila
gabor ferenc janos tibor sandor radu ion mihai florin cristian adrian vasile gheorghe constantin dumitru nicolae stefan bogdan marian sorin
`);

const WEIBLICH = liste(`
agnes alexandra alice alina angela angelika anita anja anke ann anna anne annegret annelie anneliese annemarie annette annika antje antonia ariane astrid
barbara bärbel beate beatrice beatrix bettina bianca bianka birgit birgitt birte brigitte britta carina carla carmen carola carolin caroline catharina
cathrin charlotte christa christel christiane christin christina christine clara claudia constanze cordula corinna cornelia dagmar daniela denise diana
doreen doris dorothea dorothee edeltraud edith elena eleonore elfriede elisabeth elke ellen elvira emilia emma erika erna esther eva evelyn eveline
franziska frauke frieda friederike gabi gabriela gerda gerlinde gertrud gisela gudrun gundula hanna hannah hannelore heidi heidemarie heidrun heike helena
helene helga henrike hildegard ida ilka ilona ilse ina ines inga inge ingeborg ingrid irene iris irmgard isabel isabell isabella isabelle jacqueline jana
janina janine jasmin jennifer jenny jessica johanna josefine judith julia juliane jutta karin karina karla karola karolin karoline katarina katharina
kathrin katja katrin kerstin kirsten klara kristin kristina larissa laura lea lena leonie liane lieselotte lina linda lisa lore lotte louisa luisa luise
lydia madeleine magdalena maike manuela mara mareike maren margarete margit margot margret maria marianne marie marina marion marita marlene marlies
martha martina mechthild meike melanie melissa mia michaela miriam mirjam monika nadine nadja natalie natascha nathalie nele nicole nina nora olga
patricia paula petra pia ramona rebecca rebekka regina regine renate renée rita romy rosa rosemarie roswitha ruth sabine sabrina sandra sara sarah saskia
sibylle sigrid silke silvia sina sonja sophia sophie stefanie steffi stephanie susanne susann susanna svenja svetlana swetlana sybille sylvia tamara tanja
tatjana teresa theresa therese tina traudel ulla ulrike ursula uta ute valentina vanessa vera verena veronika viktoria victoria viola waltraud wiebke
wilma yvonne
ayse ayşe fatma emine hatice zeynep elif meryem özlem sevgi gülsen aylin ebru esra hülya melek nurcan pinar selma sibel songül tülay yasemin
giulia francesca chiara paola giovanna lucia agnieszka katarzyna malgorzata małgorzata ewa joanna dorota beata iwona jolanta aleksandra natalia oksana
irina ekaterina ludmila ljudmila nadeschda galina tatiana anastasia marija jelena snezana dragana ivana mary elizabeth susan karen nancy emily amy kate jane
henriette wilhelmine ottilie hedwig herta hertha irma käthe kaethe liselotte magda mathilde minna thea traude trude walburga walli wally adelheid almut
annerose bernadette brunhilde christl dörte doerte edda elfi elli elsa else emmi evi fanny gesa gesine gitta gitte gretel hanne hella herma hilde imke
insa irmtraud isolde jule kati käte kornelia leni lilli lilly lili loni luzia maja maya malin marga margarethe margitta mariele marika marit marlen
marlis mona nadia natalia nelly olivia ortrud philippa rosi rosalie roxana ricarda rike ronja sabina senta sieglinde siglinde silja solveig stella
steffanie stefania susi suse swantje tabea thekla tilda trixi uschi valerie valeska vroni wanda wibke zita zoe amelie annabell annalena carlotta celina
chantal charline elisa emely fabienne fiona finja greta helen janna jette johanne josephine juliana lara leah lia liv lotta luna lucy madlen marleen
merle michelle mila mira neele paulina pauline rieke selina stine vivien vivian yasmin yvette anett anette annett birgitta carolina christiana conny
daniella dorit dorle elfie ella ellie evelin evelyne franzi friedel gaby gerti grit gundi heidelinde heiderose helma ingeburg irmhild jeanette jeannette
katharine kathleen katy kirstin kristiane lieselore lisbeth lisette lotti luitgard mandy manja marie-luise marietta marlena mechtild melitta mercedes
mirella monique nanette nicoletta peggy raphaela rena reni rosel roswita sandrine sibilla silvana simona sonia steffie susan suzanne sylke sylvie
tanya theres ulrika undine ursel veronica waltraut wilhelmina
`);

// Namen, die je nach Herkunft beides sein können → gültiger Vorname, aber keine Anrede.
const UNISEX = liste(`
kim andrea sascha sasha toni nicola luca jean dominique robin chris alex kai kay mika eike jo maxi uli ulli gerrit friedel marian michele simone gabriele
daniele pascale derya deniz ilkay jona noa noah sam charlie jamie kersten conny nicki nikita sandy mischa bente
`);

const basis = (vorname) => String(vorname || '').toLowerCase().split('-')[0];

module.exports = {
  istVorname: (v) => { const b = basis(v); return MAENNLICH.has(b) || WEIBLICH.has(b) || UNISEX.has(b); },
  anredeFuer: (v) => {
    const b = basis(v);
    if (UNISEX.has(b)) return '';
    if (MAENNLICH.has(b) && !WEIBLICH.has(b)) return 'Herr';
    if (WEIBLICH.has(b) && !MAENNLICH.has(b)) return 'Frau';
    return '';
  },
};
