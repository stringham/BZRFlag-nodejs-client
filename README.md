BZRFlag-nodejs-client
=====================

This is a client for BZRFlag implemented in nodejs

BZRFlag is a simple clone of BZFlag, where the R stands for Robots.

BZRFlag is used for Artificial Intelligence projects at BYU (CS470).

You can get a copy of BZRFlag here: `git clone git://aml.cs.byu.edu/bzrflag.git`

You interact with these robots using the [BZRFlag Protocol](https://facwiki.cs.byu.edu/cs470sp11/index.php/BZRC_Protocol) using sockets.

Since node is intentionally asynchronous all requests are returned via callback methods.
