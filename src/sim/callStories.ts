// Plain-language framing for each call type: what a caller typically reports, who needs help,
// and whether the call is high-risk for the responding officer. The calls themselves are real;
// these sentences are illustrative and keyed only on the call type.

export interface CallStory {
  quote: string; // what a caller typically says for this call type
  who: string; // who is waiting for help
  highRisk: boolean; // weapons or violence: officers benefit most from a first look
}

const STORIES: Record<string, CallStory> = {
  "917": { quote: "There's a man acting strangely, trying car doors on my street.", who: "a worried neighbour", highRisk: false },
  "916": { quote: "A car has been idling outside for an hour, someone watching the houses.", who: "a worried neighbour", highRisk: false },
  "459": { quote: "Someone broke into the shop next door. The glass is smashed.", who: "a business owner", highRisk: false },
  "221": { quote: "I just saw a man with a gun near the corner.", who: "people nearby", highRisk: true },
  "222": { quote: "Someone is waving a knife at people outside.", who: "people nearby", highRisk: true },
  "216": { quote: "I just heard gunshots. Three or four of them.", who: "people nearby", highRisk: true },
  "418": { quote: "Two people are fighting in the street and it's getting bad.", who: "two people in a fight", highRisk: false },
  "240": { quote: "Someone just hit a woman and walked off.", who: "someone who was attacked", highRisk: true },
  "245": { quote: "A man was hit with a bottle. He's bleeding.", who: "someone who was attacked", highRisk: true },
  "212": { quote: "I was just robbed. He grabbed my phone and ran.", who: "a robbery victim", highRisk: true },
  "211": { quote: "I was just robbed. He grabbed my phone and ran.", who: "a robbery victim", highRisk: true },
  "852": { quote: "Someone's breaking into parked cars on this block.", who: "car owners on the block", highRisk: false },
  "851": { quote: "My car's gone. It was parked right here an hour ago.", who: "a car owner", highRisk: false },
  "1030": { quote: "The car from the stolen-vehicle alert is parked outside my building.", who: "a car owner", highRisk: false },
  "100A": { quote: "The alarm at the building across the street won't stop.", who: "a building owner", highRisk: false },
  "603": { quote: "There's someone creeping around in my backyard.", who: "a scared resident", highRisk: false },
  "602": { quote: "Someone is trying to force the back door of the house next door.", who: "a family at home", highRisk: true },
  "519": { quote: "There's been a crash. Someone looks hurt.", who: "someone hurt in a crash", highRisk: false },
  "519HR": { quote: "A car hit someone and drove off.", who: "someone hit by a car", highRisk: false },
  "809": { quote: "My dad has dementia. He walked off and we can't find him.", who: "a missing person and their family", highRisk: false },
  "807": { quote: "My 12-year-old never came home from school.", who: "a missing child and their family", highRisk: false },
  "594": { quote: "Someone is smashing the windows of the bus shelter.", who: "people at the bus stop", highRisk: false },
  "601": { quote: "There's a stranger sleeping in our garage.", who: "a resident", highRisk: false },
  "910": { quote: "My neighbour hasn't answered the door in days. I'm worried.", who: "someone who may need help", highRisk: false },
  "650": { quote: "A man keeps following me and shouting threats.", who: "someone being threatened", highRisk: false },
  "488": { quote: "Someone just walked out of the store with a bag of stuff.", who: "a shop owner", highRisk: false },
  "487": { quote: "My bike was stolen right off the rack.", who: "a theft victim", highRisk: false },
  "100P": { quote: "A panic alarm went off at the bank.", who: "staff at a business", highRisk: true },
};

export function storyFor(code: string, desc: string): CallStory {
  return (
    STORIES[code] ?? {
      quote: `Caller reports: ${desc.toLowerCase()}.`,
      who: "the person who called",
      highRisk: /GUN|KNIFE|SHOT|WEAPON|ADW|ROBBERY/.test(desc),
    }
  );
}
