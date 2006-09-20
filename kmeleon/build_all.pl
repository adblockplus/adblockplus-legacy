#!/usr/bin/perl

use strict;

system("$^X build.pl adblockplus-kmeleon-en-US.zip en-US");
system("$^X build.pl adblockplus-kmeleon-de-DE.zip de-DE");
system("$^X build.pl adblockplus-kmeleon-ru-RU.zip ru-RU");
