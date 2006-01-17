#!/usr/bin/perl

use strict;

die "Version number not specified" unless @ARGV;

my $version = $ARGV[0];
$version =~ s/[^\w\.]//gs;

open(VERSION, ">version");
print VERSION $ARGV[0];
close(VERSION);

@ARGV = ("../downloads/adblockplus-$version.xpi");
do 'create_xpi.pl';

chdir('..');
system(qq(cvs add downloads/adblockplus-$version.xpi));
system(qq(cvs commit -m "Releasing Adblock Plus $version"));
