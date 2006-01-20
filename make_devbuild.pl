#!/usr/bin/perl

use strict;

open(VERSION, "version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

@ARGV = ("adblockplus-$version+.xpi", 1);
do 'create_xpi.pl';
