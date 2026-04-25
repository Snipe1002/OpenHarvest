using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OpenHarvest.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCropsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "crops",
                columns: table => new
                {
                    Slug = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    CommonName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ScientificName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    MinGrowingZone = table.Column<int>(type: "integer", nullable: true),
                    MaxGrowingZone = table.Column<int>(type: "integer", nullable: true),
                    DaysToGermination = table.Column<int>(type: "integer", nullable: true),
                    DaysToMaturity = table.Column<int>(type: "integer", nullable: true),
                    PlantSpacingInches = table.Column<double>(type: "double precision", nullable: true),
                    RowSpacingInches = table.Column<double>(type: "double precision", nullable: true),
                    CanDirectSow = table.Column<bool>(type: "boolean", nullable: false),
                    Tags = table.Column<string[]>(type: "text[]", nullable: false),
                    LastSyncedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_crops", x => x.Slug);
                });

            migrationBuilder.CreateIndex(
                name: "IX_crops_CommonName",
                table: "crops",
                column: "CommonName");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "crops");
        }
    }
}
