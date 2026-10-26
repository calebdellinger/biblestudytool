You are building a data file that records WHO IS SPEAKING in every quotation of the Berean Standard Bible (BSB). Your output will be read by a computer program, so follow the format exactly.

I will attach the BSB text for one book (lines look like `2:1 Then Joshua son of Nun secretly sent...`). Use ONLY the attached text. Never quote from memory and never use another translation.

## What to record

For every stretch of direct speech (anything inside quotation marks “ ” or ‘ ’), write one JSON object per verse:

- `ref`: book code + chapter:verse, e.g. `"JOSH 2:1"`. Use the book code given at the top of the file.
- `speaker`: an id for who is speaking (rules below).
- `text`: the spoken words, copied EXACTLY, character for character, from that verse, without the surrounding quotation marks. Keep the BSB's punctuation, capitals and curly apostrophes (’). If a speech runs over several verses, write one object per verse, each with only that verse's words.
- `tag`: the exact word(s) in the narration of that same verse that name the speaker, e.g. `"Joshua son of Nun"`, `"the king of Jericho"`, `"she"`, `"Jesus"`. Copy them exactly. Use `null` if the verse has no such words (for example, a speech continuing from the previous verse).
- `to`: the id of who is being spoken to, if clear; otherwise `null`.
- `nested_in`: if this speech is quoted inside someone else's speech (a character in Jesus' parable, a prophet quoting the LORD, Paul retelling his conversion), the id of the outer speaker; otherwise `null`. Record the outer speech too, as its own object.
- `confidence`: `"high"` if the speaker is named in the verse or the one before; `"medium"` if you worked it out from the flow of the conversation (for example, "he said" in a back-and-forth); `"low"` if you are guessing. Never leave a speech out because you're unsure; mark it `"low"` instead.
- `occurrence`: only include this if the exact `text` appears more than once in the verse; give 1 for the first, 2 for the second, and so on.

Split a verse into several objects when the speaker changes inside it, or when narration interrupts the speech (“Go,” he said, “and look.” is two objects: `"Go,"` and `"and look."`). Leave the narration out of `text`.

## Speaker ids

- Lowercase, words joined with hyphens: `joshua`, `rahab`, `king-of-jericho`, `two-spies`.
- Use the SAME id for the same person throughout the book: `jacob` stays `jacob` even after he is called Israel. Add a `"name"` field the first time an id appears in each chapter, e.g. `"name": "Jacob (Israel)"`.
- Use these ids for God: `god` whenever God or the LORD speaks; `jesus` for Jesus (including when risen or in visions); `holy-spirit`; `angel-of-the-lord`; `angel` for other angels; `satan` for Satan or the devil.
- Groups: `israelites`, `crowd`, `pharisees`, `disciples`, `people-of-<place>`, and so on. Use `unnamed-<description>` for people with no name, e.g. `unnamed-servant`.
- People with the same name are different ids: `john-the-baptist` and `john-apostle`; `mary-mother-of-jesus` and `mary-magdalene`.

## Output format

Output ONLY JSON Lines: one JSON object per line, in Bible order, with no commentary, no markdown fences and no blank lines. Work through every chapter in what I asked for, in order. If you run out of space, stop at the end of a complete verse and finish with this exact line:
`{"continue_from": "JOSH 7:12"}`
(using the next verse still to do), and I will tell you to continue.

## Example

For this text:
```
2:1 Then Joshua son of Nun secretly sent two spies from Shittim, saying, “Go, inspect the land, especially Jericho.” So they went and entered the house of a prostitute named Rahab and stayed there.
2:2 And it was reported to the king of Jericho: “Behold, some men of Israel have come here tonight to spy out the land.”
2:3 So the king of Jericho sent to Rahab and said, “Bring out the men who came to you and entered your house, for they have come to spy out the whole land.”
2:4 But the woman had taken the two men and hidden them. So she said, “Yes, the men did come to me, but I did not know where they had come from.
2:5 At dusk, when the gate was about to close, the men went out, and I do not know which way they went. Pursue them quickly, and you may catch them!”
```
the output is:
```
{"ref":"JOSH 2:1","speaker":"joshua","name":"Joshua","text":"Go, inspect the land, especially Jericho.","tag":"Joshua son of Nun","to":"two-spies","nested_in":null,"confidence":"high"}
{"ref":"JOSH 2:2","speaker":"unnamed-informants","name":"Unnamed informants","text":"Behold, some men of Israel have come here tonight to spy out the land.","tag":null,"to":"king-of-jericho","nested_in":null,"confidence":"medium"}
{"ref":"JOSH 2:3","speaker":"king-of-jericho","name":"The king of Jericho","text":"Bring out the men who came to you and entered your house, for they have come to spy out the whole land.","tag":"the king of Jericho","to":"rahab","nested_in":null,"confidence":"high"}
{"ref":"JOSH 2:4","speaker":"rahab","name":"Rahab","text":"Yes, the men did come to me, but I did not know where they had come from.","tag":"she","to":"king-of-jericho","nested_in":null,"confidence":"high"}
{"ref":"JOSH 2:5","speaker":"rahab","text":"At dusk, when the gate was about to close, the men went out, and I do not know which way they went. Pursue them quickly, and you may catch them!","tag":null,"to":"king-of-jericho","nested_in":null,"confidence":"high"}
```

Before you finish each response, check that every `text` and `tag` appears word for word in its verse.

Start with: [BOOK NAME], chapters [X] to [Y].
