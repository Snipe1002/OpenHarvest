using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OpenHarvest.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "garden_entities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GardenId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    Kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CropRef = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Transform = table.Column<string>(type: "jsonb", nullable: false),
                    Geometry = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ModifiedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Photos = table.Column<string>(type: "jsonb", nullable: true),
                    Growth = table.Column<string>(type: "jsonb", nullable: true),
                    Schedule = table.Column<string>(type: "jsonb", nullable: true),
                    Yield = table.Column<string>(type: "jsonb", nullable: true),
                    Health = table.Column<string>(type: "jsonb", nullable: true),
                    Extensions = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_garden_entities", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "gardens",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Latitude = table.Column<double>(type: "double precision", nullable: true),
                    Longitude = table.Column<double>(type: "double precision", nullable: true),
                    GrowingZone = table.Column<int>(type: "integer", nullable: true),
                    LastFrostDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    FirstFrostDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_gardens", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_garden_entities_GardenId_Kind",
                table: "garden_entities",
                columns: new[] { "GardenId", "Kind" });

            migrationBuilder.CreateIndex(
                name: "IX_garden_entities_GardenId_ModifiedUtc",
                table: "garden_entities",
                columns: new[] { "GardenId", "ModifiedUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_garden_entities_ParentId",
                table: "garden_entities",
                column: "ParentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "garden_entities");

            migrationBuilder.DropTable(
                name: "gardens");
        }
    }
}
