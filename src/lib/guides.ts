import type { Borough } from "@/lib/areas";

/**
 * Neighborhood guides, written by hand.
 *
 * These exist to be found in a search, which means they have to be worth
 * finding. The market is drowning in neighborhood pages assembled out of
 * adjectives ("vibrant", "eclectic", "a hidden gem"), and they rank badly
 * and read worse because they were written by someone who has never stood
 * on the block at 11pm on a Saturday.
 *
 * So the rule for every line below: say something a person could act on, or
 * cut it. Name the specific train, the specific catch, the thing the broker
 * will not lead with. Where a guide has an opinion it says so plainly rather
 * than hedging into mush. The numbers on the page come from the live corpus
 * at request time, so the part that dates fastest is never hand-typed here.
 */

export interface AreaGuide {
  /** Matches the slug in AREAS, which is what the app filters on. */
  slug: string;
  area: string;
  borough: Borough;
  /** The promise, and the seed of the meta description. */
  standfirst: string;
  /** What it's actually like to live there. */
  feel: string[];
  /** Who this works for, stated without hedging. */
  suits: string;
  /** The thing you find out in month two. */
  snag: string;
  /** Trains, and what they mean on a Tuesday morning. */
  transit: string;
  /** Things worth checking at a viewing here specifically. */
  checks: string[];
  /** Slugs of neighborhoods worth seeing alongside this one. */
  nearby: string[];
}

export const GUIDES: AreaGuide[] = [
  {
    slug: "east-village",
    area: "East Village",
    borough: "Manhattan",
    standfirst:
      "Cheap by Manhattan standards, loud by anyone's, and still the easiest place in the city to be twenty-five.",
    feel: [
      "The East Village is a walk-up neighborhood. Five or six storeys, no elevator, no doorman, a tub in the kitchen if the renovation was lazy. The building stock is mostly pre-war tenement, which means high ceilings and bad insulation and radiators that either roast you or do nothing.",
      "It gets genuinely loud. Avenue A and the numbered streets between Houston and 14th carry bar traffic until four in the morning on weekends, and the noise does not stay outside: single-pane windows in a 1900 building are decorative. Move one block east of Avenue B or south toward the quieter end of 4th and it drops off fast.",
    ],
    suits:
      "People who want to walk home from dinner, do not own a car, and would rather have a smaller apartment in a place they actually want to be.",
    snag:
      "Fifth-floor walk-ups price about ten percent under the same line on the second floor, and that discount stops feeling like a discount the first time you carry a month of groceries up. Look at the flight before you sign, not just the floor plan.",
    transit:
      "The L at First Avenue, the F at Second Avenue, and the 6 at Astor Place. It is the one part of Manhattan where the subway is genuinely inconvenient: from most of Alphabet City you are a ten to fifteen minute walk from any train, which is fine in May and long in February.",
    checks: [
      "Run the shower and the kitchen tap together. Tenement plumbing stacks are shared and the pressure tells you what you are in for.",
      "Ask which windows face the street and stand at them with the window open for a minute.",
      "Check the radiator knobs actually turn. In these buildings heat is landlord-controlled and a stuck valve is a whole winter.",
    ],
    nearby: ["lower-east-side", "alphabet-city", "greenwich-village"],
  },
  {
    slug: "lower-east-side",
    area: "Lower East Side",
    borough: "Manhattan",
    standfirst:
      "The same tenement stock as the East Village, a little cheaper, and further from a train.",
    feel: [
      "The Lower East Side reads as two neighborhoods stacked on each other. There is the nightlife strip around Ludlow and Orchard, which is busy in a way that decides your weekends whether you take part or not, and there is everything south and east of Delancey, which is quiet, largely residential, and where most of the actual value is.",
      "New glass buildings have gone up along the edges, and they price like Manhattan doormen buildings because that is what they are. The old stock is where the deals live, and it comes with the usual tenement bargain: character upstairs, a fifth-floor climb, a bathroom someone squeezed into a closet in 1987.",
    ],
    suits:
      "Anyone who wants East Village access on a slightly smaller budget and does not mind walking ten minutes to the train.",
    snag:
      "The F, M, J and Z at Delancey and Essex are one interchange, and it is the only real one down here. Everything east of Clinton is a genuine walk, and the buses across Delancey do not save you time.",
    transit:
      "F, M, J, Z at Delancey Street and Essex Street. The B and D at Grand Street get you up Sixth Avenue. There is no crosstown option worth the name, so anything on the west side is a transfer.",
    checks: [
      "Ask what the building does about trash. Many of these lots have no service alley and the bags go on the sidewalk out front.",
      "Look at the ceiling in the top-floor units for old water staining, which is the tell for a roof that gets patched rather than replaced.",
      "Walk the block after 10pm before you commit, especially near Ludlow and Orchard.",
    ],
    nearby: ["east-village", "chinatown", "two-bridges"],
  },
  {
    slug: "west-village",
    area: "West Village",
    borough: "Manhattan",
    standfirst:
      "The most expensive charm in the city, and the least rational street grid in it.",
    feel: [
      "The West Village is what people picture when they picture New York, which is exactly why it costs what it costs. Low brick, tree cover, streets that meet at angles the grid never reached. It is quiet by Manhattan standards and the quiet is real, not marketing.",
      "The apartments are small and old and frequently strange: rooms shaped by two hundred years of subdivision, ceilings that step down, kitchens in what were clearly hallways. You are paying for the outside of the building and the block it stands on, and it is worth being honest with yourself about that before you tour.",
    ],
    suits:
      "People with the budget to stop optimizing, and anyone whose commute is downtown or on the west side.",
    snag:
      "Broker fees are still common here and still run twelve to fifteen percent of the annual rent, because demand does not force the issue. Ask whether the fee is negotiable before you fall for a place, not after.",
    transit:
      "The 1 runs down Seventh Avenue, the A, C, E and B, D, F, M meet at West 4th, and the L hits Eighth and 14th. Getting to Midtown and downtown is easy. Getting to Brooklyn is a project.",
    checks: [
      "In a walk-up with a shared stair, listen on the landing. Sound travels through these old party walls better than through the floors.",
      "Ask about the basement and whether the building has flooded. Much of the far west is in a coastal flood zone.",
      "Confirm laundry. A surprising number of these buildings have none and no room to add it.",
    ],
    nearby: ["greenwich-village", "chelsea", "soho"],
  },
  {
    slug: "chelsea",
    area: "Chelsea",
    borough: "Manhattan",
    standfirst:
      "Doorman buildings, gallery blocks, and the best crosstown position in Manhattan.",
    feel: [
      "Chelsea is where Manhattan stops being one thing. The eastern half around Sixth and Seventh is dense, commercial, and full of large post-war rentals with elevators and gyms. West of Ninth it goes quiet and low and expensive, with the galleries and the High Line and buildings that cost what a house costs.",
      "It is one of the few neighborhoods where you can genuinely choose your building type rather than take what the block offers. That makes it a good place to hunt if you know what you want and a confusing one if you do not.",
    ],
    suits:
      "People who want an elevator, a laundry room, and a lease that does not require a broker relationship. Also anyone commuting to Midtown who refuses to live in it.",
    snag:
      "The big amenity buildings advertise a net effective rent with one or two months free. The number you will renew at is the gross rent, which is often three hundred a month higher. Make them tell you both.",
    transit:
      "The 1, 2, 3 on Seventh, the C and E on Eighth, the F and M on Sixth, and the L at 14th. Penn Station is a walk. This is close to the best-connected residential position in the borough.",
    checks: [
      "Get the concession in writing and ask what the renewal rent would be at today's numbers.",
      "In the older post-war buildings, ask whether the windows have been replaced. The originals are loud on Sixth and Seventh.",
      "Ask what floor the trash and recycling room is on if you are near it.",
    ],
    nearby: ["west-chelsea", "flatiron", "hells-kitchen"],
  },
  {
    slug: "hells-kitchen",
    area: "Hell's Kitchen",
    borough: "Manhattan",
    standfirst:
      "The cheapest way to live in walking distance of Midtown, with the trade-offs that implies.",
    feel: [
      "Hell's Kitchen is a working neighborhood that happens to sit next to the theater district. Ninth Avenue is one of the best eating streets in the city and the side streets in the forties and fifties are ordinary in a way that keeps them affordable relative to everything around them.",
      "The further north and west you go, the calmer it gets. South of 42nd and east of Ninth you are absorbing Port Authority and Times Square foot traffic, which is a real and permanent condition rather than a weekend one.",
    ],
    suits:
      "Anyone who works in Midtown and wants to walk to it, and anyone who wants a Manhattan address without a Manhattan-core price.",
    snag:
      "Tour buses, sanitation, and the Lincoln Tunnel approach mean this is a genuinely loud part of town during the day. It is a different noise from bar noise: it starts at six in the morning instead of ending at four.",
    transit:
      "A, C, E on Eighth, the 1 at 50th, the N, Q, R, W and 7 at Times Square, and the whole Midtown interchange within a few blocks. Almost nowhere in the city is hard to reach from here.",
    checks: [
      "Ask which direction the unit faces and whether it looks at the tunnel approach.",
      "Check the windows for double glazing, which in this neighborhood is worth more than any amenity.",
      "If the building is over a restaurant, ask about the kitchen exhaust and when it runs.",
    ],
    nearby: ["midtown-west", "chelsea", "upper-west-side"],
  },
  {
    slug: "upper-east-side",
    area: "Upper East Side",
    borough: "Manhattan",
    standfirst:
      "The best value per square foot in Manhattan, if you can live with the Lexington line.",
    feel: [
      "The Upper East Side is large and not uniform. West of Third it is expensive, quiet, and full of pre-war co-ops. East of Third, and particularly in Yorkville above 79th, it is one of the genuine bargains left in the borough: real one-bedrooms, elevator buildings, laundry in the basement, for money that buys a studio further downtown.",
      "It is calm. Whether that reads as civilized or as dull depends entirely on you, and it is worth being honest about which one you are before signing a year to it.",
    ],
    suits:
      "People who want space and quiet over nightlife, anyone commuting to Midtown East, and anyone who has decided a real bedroom matters more than the neighborhood's reputation.",
    snag:
      "The 4, 5 and 6 at rush hour are the most crowded trains in the system. The Q on Second Avenue fixed a lot of this above 72nd, but if your building is west of Third you are still walking to Lexington.",
    transit:
      "The 4, 5, 6 on Lexington and the Q on Second. The Q is the reason Yorkville stopped being cheap, and it is still the better ride.",
    checks: [
      "Work out the exact walk to the Q rather than the advertised one. Two avenue blocks here are longer than they look.",
      "In pre-war buildings, ask whether the line has been converted from gas and what the electrical service is. Old service means no air conditioning in more than one room.",
      "Ask what the building charges for the laundry card and whether the machines are card or coin.",
    ],
    nearby: ["yorkville", "lenox-hill", "carnegie-hill"],
  },
  {
    slug: "upper-west-side",
    area: "Upper West Side",
    borough: "Manhattan",
    standfirst:
      "Big pre-war apartments, two parks, and a neighborhood that has been comfortable for a hundred years.",
    feel: [
      "The Upper West Side has the best residential building stock in Manhattan for the money: wide pre-war lines with actual entry halls, separate dining rooms, and rooms that were designed rather than partitioned. Columbus and Amsterdam carry the shops and the noise, and the side streets between them go quiet immediately.",
      "It is a family neighborhood and it behaves like one. That means good grocery stores, early nights, and a rental market that turns over less than downtown, so good listings go faster than the prices suggest.",
    ],
    suits:
      "Anyone who wants square footage, anyone with a dog, and anyone whose commute runs down the west side.",
    snag:
      "A lot of the large apartments are subdivided shares, and a four-bedroom on the listing is often a two-bedroom with pressurized walls. Ask when the walls went up and whether they are legal.",
    transit:
      "The 1, 2, 3 on Broadway and the B and C on Central Park West. The express stops at 72nd and 96th are the difference between a fifteen minute ride to Midtown and a thirty minute one, and they are priced accordingly.",
    checks: [
      "Ask whether any interior wall is temporary and who is responsible for removing it at move-out.",
      "In buildings on Broadway, stand at the window during a train. The 1 runs shallow and you can feel it in some lines.",
      "Check the radiator count against the room count in pre-war units. Converted rooms often have none.",
    ],
    nearby: ["morningside-heights", "harlem", "hells-kitchen"],
  },
  {
    slug: "harlem",
    area: "Harlem",
    borough: "Manhattan",
    standfirst:
      "Brownstone blocks, express trains, and the most apartment you will get for the money in Manhattan.",
    feel: [
      "Harlem is where the numbers still work. Real one-bedrooms and two-bedrooms in restored brownstones and solid pre-war buildings, at rents that stopped existing below 96th Street a decade ago. The blocks between Frederick Douglass and Adam Clayton Powell in the 120s and 130s are as handsome as anything in the city.",
      "It is a neighborhood in the middle of a long argument about who it is for, and any honest guide should say so. Rents have climbed hard, the new construction is priced for people moving up from downtown, and that tension is present on the block rather than theoretical.",
    ],
    suits:
      "People who want space and are happy to be twenty minutes from Midtown on an express train rather than ten from a local one.",
    snag:
      "The quality range inside the same price band is enormous. A gut-renovated floor-through and a landlord special with a painted-over kitchen can list within two hundred dollars of each other, so the photos matter more here than almost anywhere.",
    transit:
      "The A, B, C, D at 125th, and the 2 and 3 on Lenox. The A express from 125th to Columbus Circle is about ten minutes, which is faster than plenty of Brooklyn commutes people accept without complaint.",
    checks: [
      "In a brownstone conversion, ask how many units are in the building and whether the owner lives there. It changes how fast things get fixed.",
      "Look for the building's HPD record before the viewing, not after. The older stock here has the deepest violation histories in Manhattan.",
      "Ask whether heat and hot water are included and what the winter has been like.",
    ],
    nearby: ["east-harlem", "hamilton-heights", "morningside-heights"],
  },
  {
    slug: "washington-heights",
    area: "Washington Heights",
    borough: "Manhattan",
    standfirst:
      "The last place in Manhattan where a one-bedroom is a normal amount of money.",
    feel: [
      "Washington Heights is hilly, green, and built almost entirely out of large pre-war elevator buildings, which is an unusual combination anywhere in the city. Apartments are big. Ceilings are high. Rents are roughly two thirds of what the same unit would cost forty blocks south.",
      "It is far, and pretending otherwise helps nobody. From 181st Street you are thirty to forty minutes from Midtown on a good day. What you buy with that time is a real apartment and Fort Tryon Park.",
    ],
    suits:
      "Anyone who wants a proper one-bedroom under the Manhattan median, and anyone whose work is uptown, at the hospitals, or fully remote.",
    snag:
      "The A express and the A local are a very different commute, and the difference is which end of the neighborhood you live in. Check whether your station gets the express before you decide the trip is acceptable.",
    transit:
      "The A and the 1, plus the C at the southern end. The A at 175th and 181st is the express, and it is the whole argument for living here.",
    checks: [
      "Ask which line the apartment is on and whether it faces the courtyard. Courtyard lines are quieter and darker.",
      "Test the elevator. In buildings of this age and size, one elevator for eight floors is common and outages are the main complaint.",
      "Walk the hill from the train once. The topography is real and the maps flatten it.",
    ],
    nearby: ["inwood", "hamilton-heights", "harlem"],
  },
  {
    slug: "financial-district",
    area: "Financial District",
    borough: "Manhattan",
    standfirst:
      "Converted office towers, aggressive concessions, and a neighborhood that empties on Saturday.",
    feel: [
      "The Financial District is mostly converted offices and new towers, which means high floors, gyms, roof decks, and floor plans that were laid out around a building core rather than around living in them. Studios can be genuinely odd shapes. Light is usually excellent above the twentieth floor.",
      "It is quiet at night and quiet on weekends in a way that people either love or find eerie. The grocery and restaurant situation has improved a great deal but is still thin compared to anywhere residential uptown.",
    ],
    suits:
      "People who want amenities and a doorman for less than they cost in Midtown, and anyone who works down here and wants to walk.",
    snag:
      "The concessions are the largest in Manhattan for a reason, and they mask the real rent. Two or three months free on a fourteen-month lease is common, and the renewal comes at the gross number. Work out both figures before you compare anything to another neighborhood.",
    transit:
      "Almost every line in the system passes through: the 2, 3, 4, 5, A, C, J, Z, R, W and the 1 at Rector. The PATH is at the Oculus. Nowhere is better connected, and the ferries are genuinely useful.",
    checks: [
      "Ask for the net effective and the gross rent in writing, then compare the gross to other neighborhoods.",
      "Ask about the flood plan and where the mechanicals are. Several of these buildings lost power for weeks in Sandy.",
      "Check what the amenity fee is and whether it is mandatory. It is often several hundred a year on top of rent.",
    ],
    nearby: ["battery-park-city", "two-bridges", "tribeca"],
  },
  {
    slug: "williamsburg",
    area: "Williamsburg",
    borough: "Brooklyn",
    standfirst:
      "Manhattan prices with a Brooklyn commute, and still the first place most people look.",
    feel: [
      "North Williamsburg around Bedford is new construction, amenity buildings, and a rent roll that has caught up with the Lower East Side. South Williamsburg and the blocks east toward the BQE are older, cheaper, and where you find the two-bedrooms that people actually sign.",
      "The waterfront towers are their own market: doorman, gym, pool in a couple of cases, and prices to match. If that is what you want, it is the best version of it in Brooklyn. If it is not, walk fifteen minutes inland and the neighborhood changes completely.",
    ],
    suits:
      "People who want new construction and a short ride to Manhattan, and anyone whose social life is already here.",
    snag:
      "The L is a single point of failure. Weekend service changes are frequent, and when the L is out the alternatives from Bedford are a long walk to the G or a bus over the bridge. Living further from Bedford makes this worse, not better.",
    transit:
      "The L at Bedford and Lorimer, the G at Metropolitan, and the J, M, Z at Marcy. Bedford to 14th Street is about eight minutes, which is the entire reason for the price.",
    checks: [
      "Check the weekend L schedule for the specific station before you decide the commute works.",
      "In new construction, ask what year the building opened and whether it has had facade work. A few of the 2015 to 2018 buildings have had problems.",
      "Ask whether the unit faces the BQE and stand at the window with it open.",
    ],
    nearby: ["greenpoint", "east-williamsburg", "bushwick"],
  },
  {
    slug: "bushwick",
    area: "Bushwick",
    borough: "Brooklyn",
    standfirst:
      "Space, loft conversions, and the largest gap in the city between a good listing and a bad one.",
    feel: [
      "Bushwick is where you go for room. Three and four bedroom apartments that would be impossible anywhere closer, old industrial buildings converted into lofts, and rents that still make sense split several ways. The blocks around Jefferson and Morgan are the loft end; deeper toward Knickerbocker it is ordinary residential Brooklyn and cheaper again.",
      "The variance is the story here. Two apartments on the same street at the same price can be a beautifully converted loft and an illegal partition in a building with forty open violations, and the listing photos will not always tell you which.",
    ],
    suits:
      "People sharing with roommates, anyone who needs a room to work in, and anyone who wants a lease that does not cost most of their income.",
    snag:
      "Loft conversions and pressurized walls are common and not always legal. A bedroom with no window is not a bedroom, it is a fire risk and a lease you cannot enforce. Ask directly, and look at the certificate of occupancy if the building is industrial.",
    transit:
      "The L at Jefferson, DeKalb, Morgan and Halsey, the M at Myrtle-Wyckoff and Knickerbocker, and the J and Z along Broadway. The M is the underrated one: it runs into Midtown directly and does not share the L's weekend problems.",
    checks: [
      "Ask which bedrooms have windows to the outside, and count them yourself.",
      "Pull the building's violation history before you tour. This is the part of Brooklyn where it matters most.",
      "In a loft, ask what the heat source is and what the winter bill looks like. Big volumes are expensive to warm.",
    ],
    nearby: ["east-williamsburg", "ridgewood", "bed-stuy"],
  },
  {
    slug: "greenpoint",
    area: "Greenpoint",
    borough: "Brooklyn",
    standfirst:
      "Quieter than Williamsburg, better housing stock, and one train that does not go to Manhattan.",
    feel: [
      "Greenpoint is low, residential, and largely intact: two and three family houses, small pre-war buildings, and a main street on Manhattan Avenue that still serves the neighborhood rather than visitors. It feels settled in a way that Williamsburg fifteen minutes south does not.",
      "The waterfront has filled in with towers and they are priced like Williamsburg's. The rest of the neighborhood is a different and generally better proposition: more space, more light, older buildings kept up by owners who live in them.",
    ],
    suits:
      "People who liked the idea of Williamsburg and not the reality of it, and anyone who works in Brooklyn or Long Island City.",
    snag:
      "The G is the only train in most of the neighborhood, and the G does not enter Manhattan. Every Manhattan commute is a transfer, usually to the L at Metropolitan or the E and M at Court Square. Budget the extra fifteen minutes honestly.",
    transit:
      "The G at Greenpoint Avenue and Nassau. The L at Bedford is a fifteen to twenty minute walk from the south end. The East River Ferry from India Street is genuinely fast to Midtown East in good weather.",
    checks: [
      "Time the actual door-to-desk commute with the transfer, not the map estimate.",
      "In a house conversion, ask who the neighbors are and whether the owner is one of them.",
      "Ask about oil versus gas heat in the older houses, and who pays for it.",
    ],
    nearby: ["williamsburg", "long-island-city", "east-williamsburg"],
  },
  {
    slug: "bed-stuy",
    area: "Bed-Stuy",
    borough: "Brooklyn",
    standfirst:
      "The best brownstone blocks in the city, at prices that still have not caught up to them.",
    feel: [
      "Bedford-Stuyvesant has more intact nineteenth-century housing than any neighborhood in New York, and on the good blocks it is genuinely extraordinary: unbroken rows of brownstone with original detail, deep back gardens, streets under full tree cover. Floor-through apartments in these houses are the reason people move here.",
      "It is large, and the experience varies a lot block to block. The stretch near Nostrand and the A and C is busy and well served; the middle of the neighborhood is quiet and further from everything. Both are called Bed-Stuy on a listing.",
    ],
    suits:
      "Anyone who wants a real apartment with light on two sides, and anyone willing to trade ten minutes of commute for fifty percent more space.",
    snag:
      "Many of these are owner-occupied houses with two or three units, which is usually good for maintenance and bad for flexibility. Expect stricter screening, and expect the owner to care about noise in a way a management company does not.",
    transit:
      "The A and C along Fulton, the G on Bedford-Nostrand, and the J and M along Broadway at the northern edge. The C is a local and it is slow; the A skips it. Check which one your station gets.",
    checks: [
      "Ask whether the owner lives in the building, and treat the answer as information rather than a problem.",
      "In a garden unit, ask about drainage and look at the base of the back wall for damp.",
      "Confirm which floor the apartment is on. Parlor floors have the ceilings and the light; the top floor has the heat.",
    ],
    nearby: ["crown-heights", "clinton-hill", "bushwick"],
  },
  {
    slug: "crown-heights",
    area: "Crown Heights",
    borough: "Brooklyn",
    standfirst:
      "Pre-war apartment buildings, express trains, and the museum end of Eastern Parkway.",
    feel: [
      "Crown Heights has something most of brownstone Brooklyn does not: large pre-war apartment buildings with elevators and lobbies, the kind of stock you normally have to go to Manhattan for. Along Eastern Parkway they sit across from the Brooklyn Museum and the Botanic Garden, which is about as good a front yard as renting gets.",
      "North of Atlantic it becomes lower and more residential. Franklin Avenue is the spine of the newer bars and restaurants, and prices step down noticeably as you move east from it.",
    ],
    suits:
      "People who want an elevator building and a garden nearby without a Manhattan rent, and anyone commuting on the 2, 3, 4 or 5.",
    snag:
      "The express and local stations here are far apart in practice. Living two stops off the express adds ten minutes each way, every day, and the rent difference is often smaller than that is worth.",
    transit:
      "The 2, 3, 4, 5 along Eastern Parkway, the A and C at Nostrand and Kingston, and the S shuttle to Prospect Park. Franklin Avenue is the interchange and the reason that end costs more.",
    checks: [
      "Ask when the building last did facade work. The big pre-war buildings on the parkway are expensive to maintain and it shows in the ones that are not.",
      "Ask what the heat situation is and check the radiators in every room.",
      "In a converted floor-through, ask whether the kitchen was moved and whether it was permitted.",
    ],
    nearby: ["prospect-heights", "bed-stuy", "prospect-lefferts-gardens"],
  },
  {
    slug: "park-slope",
    area: "Park Slope",
    borough: "Brooklyn",
    standfirst:
      "The park, the schools, and the reason people stop moving apartments every year.",
    feel: [
      "Park Slope is the settled version of Brooklyn: brownstone blocks running down from Prospect Park, Fifth and Seventh Avenues carrying the shops, and a rental market where units come up less often because people stay. The North Slope near Grand Army Plaza is the expensive end and the closest to the express trains.",
      "It is quiet, it is family-heavy, and it is not trying to be anything else. If you want a neighborhood that is finished rather than becoming something, this is the clearest example in Brooklyn.",
    ],
    suits:
      "People who want the park, anyone with children or planning them, and anyone who would rather sign a two-year lease than hunt again next spring.",
    snag:
      "Supply is thin and it moves fast. Good Slope listings are gone in days, often before a weekend open house, so this is a neighborhood where being early matters more than being flexible on price.",
    transit:
      "The 2, 3 at Grand Army Plaza, the B and Q at Seventh Avenue, the F and G at Fourth Avenue and Seventh Avenue, and the R on Fourth. The 2 and 3 from Grand Army are the fast ride to Manhattan.",
    checks: [
      "Ask how long the previous tenant stayed. In this neighborhood a short tenancy is worth asking about.",
      "In garden apartments, check the ceiling height at the back and the light in the middle room.",
      "Ask about the stoop and who shovels it, which sounds trivial until February.",
    ],
    nearby: ["prospect-heights", "gowanus", "windsor-terrace"],
  },
  {
    slug: "astoria",
    area: "Astoria",
    borough: "Queens",
    standfirst:
      "More apartment for the money than anywhere comparable, and a commute people underestimate.",
    feel: [
      "Astoria is low-rise, walkable, and full of small owner-run buildings, which is why the apartments are larger and better kept than the price suggests. Ditmars at the north end is quieter and cheaper; the blocks near Broadway and 30th Avenue are the busiest and the best served.",
      "The food is the real argument. Greek, Egyptian, Brazilian, Bengali, all of it neighborhood-priced rather than destination-priced, which is increasingly hard to find in Brooklyn.",
    ],
    suits:
      "Anyone who wants a one-bedroom they can afford alone, and anyone working in Midtown East or Long Island City.",
    snag:
      "The N and W run above ground along 31st Street, and apartments facing the tracks are cheaper for an obvious reason. Some people stop hearing it in a week. Some never do.",
    transit:
      "The N and W along 31st Street, and the R and M at Steinway and Northern. From Astoria Boulevard to 59th Street is about fifteen minutes, which beats a lot of Brooklyn.",
    checks: [
      "If the building is on 31st, stand in the apartment while a train passes.",
      "Ask whether the landlord lives in the building. In Astoria they often do, and it usually shows.",
      "Check whether heat and hot water are included. In small buildings here they frequently are, which changes the real cost.",
    ],
    nearby: ["long-island-city", "sunnyside", "woodside"],
  },
  {
    slug: "long-island-city",
    area: "Long Island City",
    borough: "Queens",
    standfirst:
      "New towers, real amenities, and the shortest ride to Midtown from anywhere outside Manhattan.",
    feel: [
      "Long Island City is the densest cluster of new rental construction in the city. Gyms, roof decks, package rooms, doormen, floor-to-ceiling glass, and views back at the skyline you are paying not to live in. Court Square and the waterfront at Hunters Point are where most of it is.",
      "Away from the towers it is still an industrial neighborhood turning over slowly, which means the streets can be quiet in a way that feels empty at night, and the ground-floor retail has not caught up with the number of people living above it.",
    ],
    suits:
      "People who want a new building with amenities and a very short commute, and anyone who would otherwise be looking at Midtown East for more money.",
    snag:
      "Concessions here are large and constant because so many units delivered at once. That is good for you in year one and bad at renewal, when the free months disappear and the increase lands on the gross rent.",
    transit:
      "The 7 at Court Square, Hunters Point and Vernon-Jackson, the E and M at Court Square, the G, and the ferry. Vernon-Jackson to Grand Central is about ten minutes.",
    checks: [
      "Ask for the gross rent and model the renewal before you sign.",
      "Ask which side the unit faces. The 7 runs elevated through part of the neighborhood.",
      "Check what the amenity fee covers and whether it is optional.",
    ],
    nearby: ["astoria", "greenpoint", "sunnyside"],
  },
];

/** Guides by slug, for the page and the sitemap. */
export const GUIDE_BY_SLUG = new Map(GUIDES.map((g) => [g.slug, g]));

/** Grouped for the index page, in the order people think about the city. */
export const GUIDES_BY_BOROUGH: { borough: Borough; guides: AreaGuide[] }[] = (
  ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"] as Borough[]
)
  .map((borough) => ({
    borough,
    guides: GUIDES.filter((g) => g.borough === borough),
  }))
  .filter((row) => row.guides.length > 0);
