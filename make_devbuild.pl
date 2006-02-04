#!/usr/bin/perl

use strict;

open(VERSION, "version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

$ARGV[0] ||= "*";
my $locale = ($ARGV[0] eq "*" ? "" : "-$ARGV[0]");
@ARGV = ("adblockplus-$version+$locale.xpi", $ARGV[0], 1);
do 'create_xpi.pl';
