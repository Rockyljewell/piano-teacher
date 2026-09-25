# Song library

Maestro ships with **41 free songs in 76 arrangements**, from three-note tunes for the very first lesson (level 1) to real piano repertoire (Chopin, Joplin, Satie, up to level 39). Every popular tune has an easy arrangement first, so a beginner can play many songs early and come back to the harder versions later. The code is in `js/music/songs.js`; this page lists the songs, where each one comes from and why it is free to use.

Levels use the same 1–40 scale as the curriculum (`js/music/curriculum.js`): an arrangement's level is the first level at which a student has met everything it needs (hands, rhythms, key, range, chords).

## Licensing policy

Everything here must be safe to publish in a public repository, in the United States and worldwide:

- **Only public-domain music.** Every composer died more than 100 years ago, or the tune is traditional (anonymous folk music, hymn tunes, carols) with printed sources from before 1929. Where an old tune became famous through a modern arrangement, the modern arrangement is not used.
- **Our own arrangements.** Easy versions, left-hand parts and chord accompaniments were written for Maestro. They are part of this project and share its license.
- **Transcriptions from public-domain editions.** Classical pieces were checked note by note against [Mutopia Project](https://www.mutopiaproject.org/) editions whose typesetters placed them in the public domain (each song's `source` names the file). Pieces that Mutopia only has under Creative Commons were not copied from Mutopia.
- **Melodies checked against more than memory.** Folk tunes were checked against the scores in the relevant Wikipedia articles (the melodies are public domain; the articles were only used to verify pitches and rhythms).

Left out on purpose:

| Song | Why |
| --- | --- |
| We Wish You a Merry Christmas | The famous version comes from Arthur Warrell's 1935 arrangement, which is likely still under US copyright until 2031. |
| Scarborough Fair | The well-known tune reached us through 20th-century recordings and arrangements. |
| Love Me Tender | A copyrighted 1956 adaptation of the public-domain *Aura Lea*. |
| Heart and Soul | Copyrighted (1938). |
| Chopin Nocturne Op. 9 No. 2, Beethoven "Moonlight", Mozart K. 545, Bach Invention No. 1 | Public-domain music, but the Mutopia editions are Creative Commons, and they are too long to transcribe reliably from memory. Import them yourself (see below). |

## The songs

### Kids & folk (10)

| Song | Composer | Year | Arrangements (level) | Verified against | Licence |
| --- | --- | --- | --- | --- | --- |
| Hot Cross Buns | Traditional (English street cry) | 1767 | Right hand (1)<br>Left hand (3)<br>Both hands (6) | Street cry recorded in 1733, printed as a round in 1767; melody checked against Wikipedia "Hot Cross Buns (song)". | Public domain: traditional melody. Arrangement written for Maestro. |
| Mary Had a Little Lamb | Traditional (words: Sarah Josepha Hale) | 1830 | Right hand (1)<br>Both hands (6) | Traditional American nursery song (1830). | Public domain: traditional melody. Arrangement written for Maestro. |
| Twinkle, Twinkle, Little Star | Traditional (French melody; words: Jane Taylor) | 1761 | Right hand (2)<br>Both hands (6)<br>Both hands with chords (14) | Melody "Ah! vous dirai-je, maman" (1761); checked against Wikipedia. | Public domain: traditional melody. Arrangement written for Maestro. |
| Lightly Row | Traditional (German: "Hänschen klein") | 1860 | Right hand (2)<br>Both hands (6) | German folk song, 19th century (words: Franz Wiedemann, 1860). | Public domain: traditional melody. Arrangement written for Maestro. |
| All My Little Ducklings | Traditional (German: "Alle meine Entchen") | 1850 | Right hand (2)<br>Both hands (6) | German children's song, 19th century; checked against German Wikipedia. | Public domain: traditional melody. Arrangement written for Maestro. |
| Happy Birthday to You | Mildred J. Hill (melody of "Good Morning to All") | 1893 | Right hand (9)<br>Both hands (15) | Melody checked against the score on Wikipedia "Happy Birthday to You". | Public domain: the melody was published in 1893; a US court ruling (2016) and EU copyright expiry (2017) freed the song. Arrangement written for Maestro. |
| London Bridge Is Falling Down | Traditional (English) | 1744 | Right hand (2)<br>Both hands (12) | Traditional nursery rhyme; melody checked against Wikipedia. | Public domain: traditional melody. Arrangement written for Maestro. |
| Au clair de la lune | Traditional (French) | 1780 | Hands take turns (4) | Traditional French song, 18th century. | Public domain: traditional melody. Arrangement written for Maestro. |
| Frère Jacques | Traditional (French) | 1780 | Hands take turns (7)<br>Right hand (11)<br>Round for two hands (24) | Traditional round; checked against Wikipedia. | Public domain: traditional melody. Arrangement written for Maestro. |
| Row, Row, Row Your Boat | Traditional (tune published by Eliphalet Oram Lyte) | 1881 | Right hand (12)<br>Both hands (13) | Words printed 1852, today's tune published 1881 (Lyte died 1913); checked against Wikipedia. | Public domain: traditional melody. Arrangement written for Maestro. |

### Holiday (9)

| Song | Composer | Year | Arrangements (level) | Verified against | Licence |
| --- | --- | --- | --- | --- | --- |
| Jingle Bells | James Lord Pierpont (chorus as sung since the 1890s) | 1857 | Right hand (2)<br>Both hands (12) | "The One Horse Open Sleigh" (1857); today's simpler chorus is anonymous and was recorded by 1898 (Wikipedia). | Public domain: Pierpont died in 1893, and the modern chorus dates from before 1898. Arrangement written for Maestro. |
| Silent Night | Franz Xaver Gruber | 1818 | Right hand (19)<br>Both hands (19) | Melody as usually sung today; checked against Wikipedia and the Mutopia Project hymn tune. | Public domain: Franz Xaver Gruber died in 1863. Arrangement written for Maestro. |
| Joy to the World | Lowell Mason (after Handel) | 1839 | Right hand (19)<br>Both hands (19) | Tune "Antioch", The Modern Psalmist (1839); checked against Wikipedia and Mutopia. | Public domain: Lowell Mason died in 1872. Arrangement written for Maestro. |
| God Rest Ye Merry, Gentlemen | Traditional (English) | 1827 | Right hand (15)<br>Both hands (17) | Traditional carol; melody and bass line checked against the SATB setting on Wikipedia. | Public domain: traditional melody. Arrangement written for Maestro. |
| Away in a Manger | James R. Murray | 1887 | Right hand (12)<br>Both hands (12) | Tune "Mueller" (1887); checked against Wikipedia. | Public domain: James R. Murray died in 1905. Arrangement written for Maestro. |
| The First Noel | Traditional (English) | 1833 | Right hand (13)<br>Both hands (15) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/Traditional/first_noel/first_noel.ly (melody and bass line). | Public domain: traditional melody. Arrangement written for Maestro. |
| O Come, All Ye Faithful | John Francis Wade | 1751 | Right hand (12)<br>Both hands (15) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/WadeJF/adeste_fideles/adeste_fideles.ly (melody and bass line). | Public domain: John Francis Wade died in 1786. Arrangement written for Maestro. |
| Good King Wenceslas | Traditional (Piae Cantiones) | 1582 | Right hand (8)<br>Both hands (12) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/Anonymous/GoodKingWenceslas/GoodKingWenceslas.ly (melody; moved to G major). | Public domain: traditional melody. Arrangement written for Maestro. |
| Auld Lang Syne | Traditional (Scottish; words: Robert Burns) | 1788 | Right hand (12)<br>Both hands (14) | Traditional Scottish melody (printed 1799); checked against Wikipedia. | Public domain: traditional melody. Arrangement written for Maestro. |

### Hymns & ballads (3)

| Song | Composer | Year | Arrangements (level) | Verified against | Licence |
| --- | --- | --- | --- | --- | --- |
| Amazing Grace | Traditional (tune "New Britain"; words: John Newton) | 1831 | Right hand (12)<br>Both hands (12) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/Anonymous/new_britain/new_britain.ly (bass line); melody rhythm as in E. O. Excell's 1900 setting, since the Mutopia file holds "me" a beat too long. | Public domain: traditional melody. Arrangement written for Maestro. |
| Greensleeves | Traditional (English) | 1580 | Right hand (15)<br>Both hands (16) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/Traditional/GreensleevesAcc/GreensleevesAcc.ly (melody and bass pattern). | Public domain: traditional melody. Arrangement written for Maestro. |
| Old Hundredth | Louis Bourgeois (Genevan Psalter) | 1551 | Right hand (8)<br>Both hands (12) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/Anonymous/Old100-orig/Old100-orig.ly (melody in its original rhythm). | Public domain: Louis Bourgeois died in 1560. Arrangement written for Maestro. |

### Classical (16)

| Song | Composer | Year | Arrangements (level) | Verified against | Licence |
| --- | --- | --- | --- | --- | --- |
| Ode to Joy | Ludwig van Beethoven | 1824 | Right hand (1)<br>Both hands – easy (7)<br>Both hands (12) | Theme from the finale of Symphony No. 9; checked against Wikipedia and the Mutopia SATB setting. | Public domain: Ludwig van Beethoven died in 1827. Arrangement written for Maestro. |
| Lullaby (Wiegenlied) | Johannes Brahms | 1868 | Right hand (12)<br>Both hands (14) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/BrahmsJ/O49/Wiegenlied/ (melody of Op. 49 No. 4, moved to C major). | Public domain: Johannes Brahms died in 1897. Arrangement written for Maestro. |
| Minuet in G | Christian Petzold (once attributed to J. S. Bach) | 1725 | Right hand (first half) (13)<br>Both hands (18) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/BachJS/BWVAnh114/anna-magdalena-04/anna-magdalena-04.ly (BWV Anh. 114). | Public domain: Christian Petzold died in 1733. Notes follow a public-domain Mutopia Project edition. |
| Minuet in F, K. 2 | Wolfgang Amadeus Mozart | 1762 | Both hands (23) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/MozartWA/KV2/menuet_k2/menuet_k2.ly | Public domain: Wolfgang Amadeus Mozart died in 1791. Notes follow a public-domain Mutopia Project edition. |
| Canon in D | Johann Pachelbel | 1694 | Both hands (16) | Our own piano arrangement of the ground bass and the first four violin variations; checked against the score on Wikipedia. | Public domain: Johann Pachelbel died in 1706. Arrangement written for Maestro. |
| Eine kleine Nachtmusik | Wolfgang Amadeus Mozart | 1787 | Right hand (19)<br>Both hands (19) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/MozartWA/KV525/eine-kleine-nachtmusik-mvt1/ (first violin and bass, an octave lower). | Public domain: Wolfgang Amadeus Mozart died in 1791. Arrangement written for Maestro. |
| In the Hall of the Mountain King | Edvard Grieg | 1875 | Both hands (18) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/GriegE/O46/Dans_l_antre_du_roi_de_la_montagne/ (theme checked against Grieg's piano version). | Public domain: Edvard Grieg died in 1907. Arrangement written for Maestro. |
| Old French Song | Pyotr Ilyich Tchaikovsky | 1878 | Right hand (19)<br>Both hands (19) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/TchaikovskyPI/O39/16OldFrenchSong/16OldFrenchSong.ly (Album for the Young, Op. 39 No. 16; inner voices simplified). | Public domain: Pyotr Ilyich Tchaikovsky died in 1893. Notes follow a public-domain Mutopia Project edition. |
| Sonatina in C, Op. 36 No. 1 | Muzio Clementi | 1797 | Both hands (exposition) (18) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/ClementiM/O36/sonatina-1/sonatina-1.ly (first movement, bars 1–15). | Public domain: Muzio Clementi died in 1832. Notes follow a public-domain Mutopia Project edition. |
| Musette in D | Anonymous (Anna Magdalena Bach Notebook) | 1725 | Both hands (22) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/BachJS/BWVAnh126/anna-magdalena-22/anna-magdalena-22.ly (BWV Anh. 126, played da capo). | Public domain: anonymous music from the 1725 Notebook for Anna Magdalena Bach. Notes follow a public-domain Mutopia Project edition. |
| Prelude in C, BWV 846 | Johann Sebastian Bach | 1722 | Both hands (complete) (25) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/BachJS/BWV846/wtk1-prelude1/wtk1-prelude1.ly (Well-Tempered Clavier, Book I). | Public domain: Johann Sebastian Bach died in 1750. Notes follow a public-domain Mutopia Project edition. |
| Für Elise | Ludwig van Beethoven | 1810 | Theme with easy left hand (20)<br>Both hands (26) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.ly (WoO 59, opening section). | Public domain: Ludwig van Beethoven died in 1827. Notes follow a public-domain Mutopia Project edition. |
| Gymnopédie No. 1 | Erik Satie | 1888 | Melody and bass (18)<br>Both hands (27) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/SatieE/gymnopedie_1/gymnopedie_1.ly (first section). | Public domain: Erik Satie died in 1925. Notes follow a public-domain Mutopia Project edition. |
| Arabesque, Op. 100 No. 2 | Friedrich Burgmüller | 1851 | Both hands (26) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/BurgmullerJFF/O100/25EF-02/25EF-02.ly (opening section and coda). | Public domain: Friedrich Burgmüller died in 1874. Notes follow a public-domain Mutopia Project edition. |
| Rondo alla Turca | Wolfgang Amadeus Mozart | 1783 | Theme (easier) (24)<br>Both hands (32) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/MozartWA/KV331/KV331_3_RondoAllaTurca/ (Sonata K. 331, finale, opening section; trill simplified). | Public domain: Wolfgang Amadeus Mozart died in 1791. Notes follow a public-domain Mutopia Project edition. |
| Prelude in E minor, Op. 28 No. 4 | Frédéric Chopin | 1839 | Both hands (complete) (30) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/ChopinFF/O28/Chop-28-4/Chop-28-4.ly (complete; grace notes omitted). | Public domain: Frédéric Chopin died in 1849. Notes follow a public-domain Mutopia Project edition. |

### Ragtime & blues (3)

| Song | Composer | Year | Arrangements (level) | Verified against | Licence |
| --- | --- | --- | --- | --- | --- |
| Maestro Blues | Maestro (original) | 2026 | Both hands – easy (20)<br>Both hands – walking bass (32) | Written for this app. | Original composition written for Maestro; same license as this project. |
| The Entertainer | Scott Joplin | 1902 | Theme with easy left hand (21)<br>Both hands (35) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/JoplinS/entertainer/entertainer.ly (introduction and first strain). | Public domain: Scott Joplin died in 1917. Notes follow a public-domain Mutopia Project edition. |
| Maple Leaf Rag | Scott Joplin | 1899 | Both hands (first strain) (39) | Mutopia Project (public domain): https://www.mutopiaproject.org/ftp/JoplinS/maple/maple.ly (first strain; the right hand's dip into the bass in bar 7 is given to the left hand). | Public domain: Scott Joplin died in 1917. Notes follow a public-domain Mutopia Project edition. |

## The notation

Each arrangement stores one string per hand, bar by bar. It is meant to be easy to read in a code review:

```js
{
  id: 'both', name: 'Both hands', level: 6, key: 'C', time: '4/4', bpm: 96,
  rh: `E4:h/3 D4/2 | C4:w/1 | E4:h/3 D4/2 | C4:w/1 |
       C4:q/1 C4 C4 C4 | D4/2 D4 D4 D4 | E4:h/3 D4/2 | C4:w/1`,
  lh: `C3:w/5 | C3 | C3 | C3 | C3 | G3/1 | C3:h/5 G3/1 | C3:w/5`,
}
```

| Token | Meaning |
| --- | --- |
| `C4:q` | A note: letter, accidental (`#`, `##`, `b`, `bb`, `n`), octave (C4 is middle C), then a duration: `w` `h` `q` `8` `16` `32`. |
| `E4` | Leaving out the duration repeats the previous one. |
| `G4:h.` `C4:8t` | `.` makes a note dotted, `t` makes it a triplet (three `8t` fill one beat). |
| `F#4` | Pitches are absolute: `F#4` is F sharp even in C major. The key signature is only for display. |
| `r:q` `R` | A rest; `R` alone fills the whole bar. |
| `[C3 E3 G3]:h` | A chord. |
| `G4:h~` | A tie into the next note or chord of the same hand. |
| `C4:q/1` `[C3 E3 G3]:w/531` | Finger numbers, in the order the notes are written. |
| `%` | Repeat the previous bar. |
| `; text` | A comment to the end of the line. |

Arrangement fields: `key` (`'C'`, `'F#'`, `'Bb'`, `'Am'`, `'C#m'`…), `time` (`'4/4'`, `'3/4'`, `'2/4'`, `'6/8'`), `bpm` (always quarter notes per minute; in 6/8 a dotted quarter is `bpm / 1.5`), `level`, optional `pickup` (beats in the first, short bar) and optional `note` shown to the student.

Every bar must add up exactly to the time signature (the first bar to `pickup` beats if there is one), and both hands must have the same number of bars; the parser reports the song, hand and bar when something is off. When a song has a pickup, `songPiece()` pads the first bar with rests, marks them `pickup: true`, and reports `piece.pickup` and `piece.startBeat`.

### Adding a song

1. Check that it is public domain (see the policy above) and find a reliable source for the melody.
2. Add an entry to `LIBRARY` in `js/music/songs.js`: metadata (`id`, `title`, `composer`, `year`, `origin`, `category`, `license`, `source`, `about`) and arrangements, easiest first.
3. Run `node --test tests/songs.test.js`. It parses every bar of every arrangement and builds and checks a piece for every hand.
4. To turn a MIDI file into notation text, import it with `midiToPiece()` and print it with `handToText(piece, 'R')` and `handToText(piece, 'L')`. Then clean it up by hand.

## Importing MIDI files

`midiToPiece(arrayBuffer, options)` in `js/music/midi.js` turns any Standard MIDI File into a playable piece:

- **Parsing:** format 0 and 1, running status, tempo, time and key signatures, track names, UTF-8/UTF-16 text. Drums (channel 10) are ignored.
- **Meter:** 4/4, 3/4, 2/4 and 6/8 map directly. 2/2 becomes 4/4, 3/8 and 12/8 become 6/8, and 9/8 becomes 3/4 with triplets. Other meters fall back to 4/4.
- **Pickups:** a file that starts with an upbeat is realigned so the first strong beat starts a bar (or pass `pickup: beats`).
- **Rhythm:** notes snap to sixteenths (or eighths for loosely played files, or `quantize: 8 | 16`), and beats played in triplets are detected and written as triplets.
- **Hands:** two-staff piano files keep their tracks as hands. Otherwise notes are split by pitch with a split point that follows the music, and every chord stays within reach of one hand. `handSplit: 60` forces a fixed split.
- **Reading:** each hand becomes one voice. Chords are merged, notes are cut at the next chord, long notes are written as ties, gaps become rests, and notes off the keyboard move by octaves.
- **Result:** the same piece shape as a generated exercise, with `level` estimated on the curriculum scale (`estimateLevel`), a key estimated from the notes when the file has none, and `maxMeasures` (default 64) to keep long files manageable.

Good MIDI files come from notation software (Mutopia, MuseScore exports). Files recorded from a live performance import too, but the rhythm may need a slower tempo or `quantize: 8`.

## Where to find more free music

These are also exported as `FREE_SOURCES` for the app to show:

| Site | What you get | MIDI to import |
| --- | --- | --- |
| [Mutopia Project](https://www.mutopiaproject.org/) | Over 2,000 classical pieces typeset by volunteers, each with a free MIDI file. Many are public domain, the rest Creative Commons. (MIDI, PDF, LilyPond) | Yes |
| [IMSLP (Petrucci Music Library)](https://imslp.org/) | The largest library of public-domain scores: scans of original editions of almost every classical piano work, plus some MIDI files. (PDF, MIDI (some works)) | Yes |
| [Musopen](https://musopen.org/sheetmusic/) | Public-domain sheet music and recordings with no copyright restrictions, easy to browse by composer and instrument. (PDF, audio) | No |
| [Choral Public Domain Library (CPDL)](https://www.cpdl.org/) | Free choral scores, including thousands of hymns and carols. Many pages include a MIDI file of every voice. (PDF, MIDI, MusicXML) | Yes |
| [Hymnary.org](https://hymnary.org/) | Hymn tunes and texts from centuries of hymnals, with MIDI files for many public-domain tunes. (MIDI, PDF) | Yes |
| [abcnotation.com](https://abcnotation.com/) | A search engine for folk tunes written in ABC notation; each tune page offers a MIDI download. (ABC, MIDI, PDF) | Yes |
| [Open Goldberg Variations](https://www.opengoldbergvariations.org/) | Bach's Goldberg Variations: a new score and recording released into the public domain (CC0). (PDF, MuseScore, audio) | No |
| [Open Well-Tempered Clavier](https://welltemperedclavier.org/) | Bach's Well-Tempered Clavier Book 1 as a CC0 score and recording, including the Prelude in C. (PDF, MuseScore, audio) | No |
| [MuseScore public-domain scores](https://musescore.com/sheetmusic/public-domain) | Community-made scores filtered to public-domain works. The MuseScore app can export any score to MIDI; downloads may need a free account. (MuseScore, MIDI, PDF) | Yes |
| [Levy Sheet Music Collection](https://levysheetmusic.mse.jhu.edu/) | Johns Hopkins' 30,000 pieces of American popular sheet music since 1780: ragtime, marches and parlour songs (US public domain if published before 1929). (PDF, images) | No |

Licences differ from piece to piece on most of these sites. Check the licence of each file before you share a copy.
