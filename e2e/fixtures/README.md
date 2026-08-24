# Fixtures

`checkin.png` is a 64×64 PNG generated once and committed, not produced at test
time.

**A real image, on purpose.** `preparePhoto` decodes it through a canvas,
applies EXIF orientation, resizes and re-encodes it as WebP. A stub of a few
bytes would fail `sniff` or fail to decode, and mocking the decode would mean
the one part of the upload path that can only be tested in a browser never was.

It is deliberately not a solid colour: a uniform image compresses to almost
nothing, so a resize that silently did nothing would still look like a pass.
