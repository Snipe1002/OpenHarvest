using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OpenHarvest.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomPrefabs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "custom_prefabs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GardenId = table.Column<Guid>(type: "uuid", nullable: false),
                    Slug = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Icon = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    EntityKind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    CropRef = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    GeometryJson = table.Column<string>(type: "text", nullable: false),
                    TagsJson = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_custom_prefabs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_custom_prefabs_GardenId_Slug",
                table: "custom_prefabs",
                columns: new[] { "GardenId", "Slug" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "custom_prefabs");
        }
    }
}
