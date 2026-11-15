// Common English words, lowercase, roughly ordered by frequency.
// The first 200 entries form the "english200" list; the whole (de-duplicated) list is "english1k".

const RAW = `
the be of and a to in he have it that for they i with as not on she at by this we you do but from or which one would
all will there say who make when can more if no man out other so what time up go about than into could state only new
year some take come these know see use get like then first any work now may such give over think most even find day
also after way many must look before great back through long where much should well people down own just because good
each those feel seem how high too place little world very still nation hand old life tell write become here show house
both between need mean call develop under last right move thing general school never same another begin while number
part turn real leave might want point form off child few small since against ask late home interest large person end
open public follow during present without again hold govern around possible head consider word program problem however
lead system set order eye plan run keep face fact group play stand increase early course change help line
city put close case force meet once water upon war build hear light unite live every country bring center let side try
provide continue name certain power pay result question study woman member until far night always service away report
something company week church toward start social room figure nature though young less enough almost read include
president nothing yet better big boy cost business value second why clear expect family complete act sense mind
experience art next near direct car law industry important girl god several matter usual rather per often kind among
white reason action return foot care simple within love human along appear doctor believe speak active student month
drive concern best door hope example inform body ever least probable understand reach effect different idea whole
control condition field pass fall note special talk particular today measure walk teach low hour type carry rate remain
full street easy although record sit determine level local sure receive thus moment spirit train college religion
perhaps music grow free cause serve age book board recent sound office cut step class true history position above
strong friend necessary add court deal tax support party whether either land material happen education death agree arm
mother across quite anything town past view society manage answer break organize half fire lose money stop actual
already effort wait department able political learn voice air together shall cover common subject draw short wife
treat limit road letter color behind produce send term total university rise century success minute remember purpose
test fight watch situation south ago difference stage father table rest bear entire market prepare explain offer plant
charge ground west picture hard front lie modern dark surface rule regard dance peace observe future wall farm claim
firm operation further pressure property morning amount top outside piece sometimes beauty trade fear demand wonder
list accept judge paint mile soon responsible allow secretary heart union slow island enter drink story experiment
stay paper space apply decide share desire spend sign therefore various visit supply officer doubt private immediate
wish contain feed raise describe ready horse son exist north suggest station effective food deep wide alone character
english happy critic unit product respect drop nor fill cold represent sudden basic kill fine trouble mark single
press heavy attempt origin standard everything committee moral black red bad earth accord else mere die remark basis
except equal east event employ defense smile river improve game detail account cent sort reduce club buy attention
ship decision wear inside win suppose ride operate realize sale choose park square vote price district dead foreign
window beyond direction strike instead trial practice catch opportunity likely recognize permit serious attack floor
association spring lot stock lack hair science relation profession pattern quick medical influence occasion machine
compare husband blue international fair especially indeed imagine surprise average official temperature difficult
sing hit tree race police touch relative throw quality former pull chance prove argue settle growth date heat save
performance count production listen main pick size cool army patient combine summer hall slight command enjoy length
proper express health chief evening store language degree lay current gun dog plane page weak connect majority
element method season middle role sell green maintain message phone safe central culture energy finish garden
discover hospital brother sister create popular issue animal factor decade article shoot seven eight nine ten hundred
thousand million four five six three two percent whose itself himself herself themselves myself yourself between
television kitchen couple project region bank rock design range fish period team agency sea film executive model fly
bed box memory lawyer ball baby bit bill glass wrong travel smart quiet rich poor warm simple bright thick thin wild
clean fresh round sharp soft sweet tall tiny young angry busy calm cheap dry empty fast flat glad huge kind loud lucky
narrow nice plain proud rare rough sad shy silly smooth sour steep strange tight tough ugly wet wise yellow orange
brown pink gray silver gold winter autumn monday friday sunday week month spring coffee tea bread milk sugar salt
butter cheese apple fruit meat rice egg soup lunch dinner breakfast meal cook bake eat taste smell sleep dream wake
rain snow wind storm cloud sky sun moon star ocean lake hill mountain forest desert valley beach bridge tower village
garden flower grass leaf seed root branch bird cat cow sheep pig mouse lion bear wolf fox rabbit duck insect snake
shirt shoe hat coat dress pocket ring watch bag key lock chair desk lamp bed wall roof floor stair gate fence yard
engine wheel road rail train truck boat bus bike ticket trip map guide hotel shop mall cash coin card bill rent loan
debt profit wage budget price sale deal brand goal task skill tool rule step phase stage scene shape edge corner
circle angle curve dot spot mark note sign code data file screen click link search send post chat email text photo
video sound song band beat tune tone noise voice speech joke laugh cry shout whisper sigh breath pulse nerve brain
bone skin blood tooth mouth nose ear neck shoulder chest knee leg toe finger thumb fist palm wrist elbow hip spine
`;

export const ENGLISH_1K: string[] = Array.from(new Set(RAW.split(/\s+/).filter(Boolean)));
export const ENGLISH_200: string[] = ENGLISH_1K.slice(0, 200);
