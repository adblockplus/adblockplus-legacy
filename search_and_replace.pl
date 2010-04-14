#!/usr/bin/perl

use strict;

my $exec = 0;
for (my $i = 0; $i < @ARGV; $i++)
{
  if ($ARGV[$i] eq "-e")
  {
    $exec = 1;
    splice(@ARGV, $i--, 1);
  }
}

die "Usage: $^X $0 [-e] <regexp> <replaceBy>\n" unless @ARGV >= 2;
my ($from, $to) = @ARGV;

doDir('.');

sub doDir
{
  my $dir = shift;

  opendir(local *DIR, $dir) or die "Could not open directory $dir";
  foreach (readdir(DIR))
  {
    next if /^\./;

    my $path = "$dir/$_";
    if (-f $path)
    {
      doFile($path);
    }
    elsif (-d $path)
    {
      doDir($path);
    }
  }
  closedir(DIR);
}

sub doFile
{
  my $file = shift;

  print "$file\n";
  open(local *FILE, $file) or die "Could not read file $file";
  binmode(FILE);
  local $/;
  my $data = <FILE>;
  my $count;
  if ($exec)
  {
    $count = ($data =~ s/$from/$to/gee);
  }
  else
  {
    $count = ($data =~ s/$from/$to/g);
  }
  close(FILE);

  if ($count)
  {
    open(FILE, ">$file") or die "Could not write file $file";
    binmode(FILE);
    print FILE $data;
    close(FILE);
  }
}
