#!/usr/bin/perl

use strict;

my $GECKO_DIR = 'c:\FFTree1\mozilla\dist';
system(qq($GECKO_DIR\\bin\\xpidl.exe -m typelib -I $GECKO_DIR\\idl -e components\\nsAdblockPlus.xpt nsAdblockPlus.idl));
